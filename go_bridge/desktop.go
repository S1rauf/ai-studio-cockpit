package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

var (
	user32                  = syscall.NewLazyDLL("user32.dll")
	procSetProcessDPIAware  = user32.NewProc("SetProcessDPIAware")
	procEnumWindows         = user32.NewProc("EnumWindows")
	procIsWindowVisible     = user32.NewProc("IsWindowVisible")
	procIsIconic            = user32.NewProc("IsIconic")
	procShowWindow          = user32.NewProc("ShowWindow")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procGetWindowTextW      = user32.NewProc("GetWindowTextW")
	procGetWindowRect       = user32.NewProc("GetWindowRect")
	procSetCursorPos        = user32.NewProc("SetCursorPos")
	procMouseEvent          = user32.NewProc("mouse_event")
	procSendInput           = user32.NewProc("SendInput")
)

const (
	swRestore        = 9
	mouseLeftDown    = 0x0002
	mouseLeftUp      = 0x0004
	mouseRightDown   = 0x0008
	mouseRightUp     = 0x0010
	inputKeyboard    = 1
	keyeventfKeyUp   = 0x0002
	keyeventfUnicode = 0x0004
)

func init() {
	if runtime.GOOS == "windows" {
		_, _, _ = procSetProcessDPIAware.Call()
	}
}

type winRect struct {
	Left, Top, Right, Bottom int32
}

type windowInfo struct {
	HWND   uintptr
	Title  string
	Rect   winRect
	Width  int32
	Height int32
}

type keybdInput struct {
	wVk         uint16
	wScan       uint16
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type inputUnion struct {
	ki keybdInput
	_  [8]byte
}

type winInput struct {
	inputType uint32
	_         uint32
	u         inputUnion
}

func enumAllWindows() []windowInfo {
	var list []windowInfo
	cb := syscall.NewCallback(func(hwnd uintptr, lparam uintptr) uintptr {
		vis, _, _ := procIsWindowVisible.Call(hwnd)
		if vis == 0 {
			return 1
		}
		buf := make([]uint16, 256)
		n, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), 256)
		if n == 0 {
			return 1
		}
		title := syscall.UTF16ToString(buf[:n])
		if strings.TrimSpace(title) == "" {
			return 1
		}
		var r winRect
		_, _, _ = procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
		w := r.Right - r.Left
		h := r.Bottom - r.Top
		if w < 40 || h < 40 {
			return 1
		}
		list = append(list, windowInfo{
			HWND:   hwnd,
			Title:  title,
			Rect:   r,
			Width:  w,
			Height: h,
		})
		return 1
	})
	_, _, _ = procEnumWindows.Call(cb, 0)
	return list
}

func findTargetWindow(query string) (*windowInfo, error) {
	wins := enumAllWindows()
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return nil, fmt.Errorf("window title is required")
	}
	for _, w := range wins {
		if strings.Contains(strings.ToLower(w.Title), q) {
			return &w, nil
		}
	}
	return nil, fmt.Errorf("window matching %q not found", query)
}

func focusWindow(query string) (*windowInfo, error) {
	w, err := findTargetWindow(query)
	if err != nil {
		return nil, err
	}
	iconic, _, _ := procIsIconic.Call(w.HWND)
	if iconic != 0 {
		_, _, _ = procShowWindow.Call(w.HWND, swRestore)
		time.Sleep(150 * time.Millisecond)
	}
	_, _, _ = procSetForegroundWindow.Call(w.HWND)
	time.Sleep(150 * time.Millisecond)
	var r winRect
	_, _, _ = procGetWindowRect.Call(w.HWND, uintptr(unsafe.Pointer(&r)))
	w.Rect = r
	w.Width = r.Right - r.Left
	w.Height = r.Bottom - r.Top
	return w, nil
}

func resolveScreenXY(windowQuery string, x, y int) (int32, int32, error) {
	if strings.TrimSpace(windowQuery) == "" {
		return int32(x), int32(y), nil
	}
	w, err := focusWindow(windowQuery)
	if err != nil {
		return 0, 0, err
	}
	return w.Rect.Left + int32(x), w.Rect.Top + int32(y), nil
}

func sendKeyEvent(vk uint16, scan uint16, flags uint32) {
	inp := winInput{
		inputType: inputKeyboard,
		u: inputUnion{
			ki: keybdInput{
				wVk:     vk,
				wScan:   scan,
				dwFlags: flags,
			},
		},
	}
	_, _, _ = procSendInput.Call(1, uintptr(unsafe.Pointer(&inp)), unsafe.Sizeof(inp))
}

func typeUnicodeText(text string) {
	units := utf16.Encode([]rune(text))
	for _, u := range units {
		sendKeyEvent(0, u, keyeventfUnicode)
		sendKeyEvent(0, u, keyeventfUnicode|keyeventfKeyUp)
		time.Sleep(4 * time.Millisecond)
	}
}

func parseVirtualKey(name string) (uint16, bool) {
	k := strings.ToLower(strings.TrimSpace(name))
	if len(k) == 1 {
		ch := k[0]
		if ch >= 'a' && ch <= 'z' {
			return uint16(ch - 'a' + 'A'), true
		}
		if ch >= '0' && ch <= '9' {
			return uint16(ch), true
		}
	}
	switch k {
	case "ctrl", "control":
		return 0x11, true
	case "alt", "menu":
		return 0x12, true
	case "shift":
		return 0x10, true
	case "win", "lwin":
		return 0x5B, true
	case "enter", "return":
		return 0x0D, true
	case "esc", "escape":
		return 0x1B, true
	case "tab":
		return 0x09, true
	case "space":
		return 0x20, true
	case "backspace", "bs":
		return 0x08, true
	case "del", "delete":
		return 0x2E, true
	case "up":
		return 0x26, true
	case "down":
		return 0x28, true
	case "left":
		return 0x25, true
	case "right":
		return 0x27, true
	}
	if strings.HasPrefix(k, "f") {
		if n, err := strconv.Atoi(k[1:]); err == nil && n >= 1 && n <= 12 {
			return uint16(0x6F + n), true
		}
	}
	return 0, false
}

func sendHotkey(combo string) error {
	parts := strings.Split(combo, "+")
	var vks []uint16
	for _, p := range parts {
		vk, ok := parseVirtualKey(p)
		if !ok {
			return fmt.Errorf("unknown key in hotkey: %s", p)
		}
		vks = append(vks, vk)
	}
	for _, vk := range vks {
		sendKeyEvent(vk, 0, 0)
		time.Sleep(15 * time.Millisecond)
	}
	for i := len(vks) - 1; i >= 0; i-- {
		sendKeyEvent(vks[i], 0, keyeventfKeyUp)
		time.Sleep(15 * time.Millisecond)
	}
	return nil
}

func captureWindowPNG(cwd string, windowQuery string, savePath string) (string, int32, int32, error) {
	w, err := focusWindow(windowQuery)
	if err != nil {
		return "", 0, 0, err
	}
	if strings.TrimSpace(savePath) == "" {
		savePath = "desktop_shot.png"
	}
	absTarget, err := resolveSafePath(cwd, savePath)
	if err != nil {
		return "", 0, 0, err
	}
	_ = os.MkdirAll(filepath.Dir(absTarget), 0755)

	esc := strings.ReplaceAll(absTarget, "'", "''")
	ps := fmt.Sprintf(`
Add-Type -AssemblyName System.Drawing,System.Windows.Forms
$bmp = New-Object Drawing.Bitmap(%d, %d)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(%d, %d, 0, 0, $bmp.Size)
$bmp.Save('%s', [Drawing.Imaging.ImageFormat]::Png)
[Windows.Forms.Clipboard]::SetImage($bmp)
$g.Dispose()
$bmp.Dispose()
`, w.Width, w.Height, w.Rect.Left, w.Rect.Top, esc)

	cmd := exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", ps)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return "", 0, 0, fmt.Errorf("screenshot failed: %s (%v)", errBuf.String(), err)
	}
	return savePath, w.Width, w.Height, nil
}

func clickUIAElementByName(cwd, windowQuery, elementName string) (string, error) {
	w, err := focusWindow(windowQuery)
	if err != nil {
		return "", err
	}
	escName := strings.ReplaceAll(elementName, "'", "''")
	ps := fmt.Sprintf(`
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms,System.Drawing
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]%d)
$els = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$target = $null
foreach ($e in $els) {
  $n = $e.Current.Name
  if ($n -and ($n.ToLower().Contains('%s'.ToLower()))) {
    $r = $e.Current.BoundingRectangle
    if ($r.Width -gt 0 -and $r.Height -gt 0) { $target = $e; break }
  }
}
if (-not $target) {
  Write-Error "UIA element matching '%s' not found"
  exit 1
}
$r = $target.Current.BoundingRectangle
$cx = [int]($r.Left + $r.Width/2)
$cy = [int]($r.Top + $r.Height/2)
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($cx, $cy)
Start-Sleep -Milliseconds 30
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int c, int e);' -Name U -Namespace W
[W.U]::mouse_event(0x02, 0, 0, 0, 0)
Start-Sleep -Milliseconds 30
[W.U]::mouse_event(0x04, 0, 0, 0, 0)
Write-Output "UIA_CLICKED: $($target.Current.Name) [$($target.Current.ControlType.ProgrammaticName)] at ($cx,$cy)"
`, w.HWND, escName, escName)

	return runLocalCmd(cwd, "powershell.exe", "-NoProfile", "-Command", ps)
}

func queryWindowUITree(cwd, windowQuery string) (string, error) {
	w, err := focusWindow(windowQuery)
	if err != nil {
		return "", err
	}
	ps := fmt.Sprintf(`
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]%d)
$els = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
$limit = [Math]::Min($els.Count, 120)
for ($i=0; $i -lt $limit; $i++) {
  $e = $els[$i]
  $c = $e.Current
  $r = $c.BoundingRectangle
  if ($r.Width -le 0 -or $r.Height -le 0) { continue }
  $type = $c.ControlType.ProgrammaticName -replace '^ControlType\.',''
  $name = ($c.Name -replace '[\r\n]+',' ').Trim()
  if ($name -eq '' -and $type -in @('Pane','Group','Custom')) { continue }
  $rx = [int]($r.Left - %d + $r.Width/2)
  $ry = [int]($r.Top - %d + $r.Height/2)
  $out += ("$type | [$name] | center=($rx,$ry) | size=$([int]$r.Width)x$([int]$r.Height)")
}
$out -join [char]10
`, w.HWND, w.Rect.Left, w.Rect.Top)
	return runLocalCmd(cwd, "powershell.exe", "-NoProfile", "-Command", ps)
}

func runDesktopTool(cwd string, call AgentToolCall) (string, error) {
	if runtime.GOOS != "windows" {
		return "", fmt.Errorf("desktop tools currently require Windows")
	}
	tool := strings.ToUpper(strings.TrimSpace(call.Tool))

	switch tool {
	case "WIN_LIST":
		wins := enumAllWindows()
		var lines []string
		for _, w := range wins {
			lines = append(lines, fmt.Sprintf("[0x%X] %q  pos=(%d,%d) size=%dx%d", w.HWND, w.Title, w.Rect.Left, w.Rect.Top, w.Width, w.Height))
		}
		if len(lines) == 0 {
			return "(no visible windows)", nil
		}
		return strings.Join(lines, "\n"), nil

	case "WIN_FOCUS":
		w, err := focusWindow(call.Window)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("FOCUSED %q pos=(%d,%d) size=%dx%d", w.Title, w.Rect.Left, w.Rect.Top, w.Width, w.Height), nil

	case "UI_TREE":
		return queryWindowUITree(cwd, call.Window)

	case "UIA_CLICK":
		elem := call.Name
		if elem == "" {
			elem = call.Query
		}
		if elem == "" {
			return "", fmt.Errorf("UIA_CLICK requires 'name' (e.g. name: 'Кисти' or name: 'Красный')")
		}
		return clickUIAElementByName(cwd, call.Window, elem)

	case "MOUSE_CLICK":
		sx, sy, err := resolveScreenXY(call.Window, call.X, call.Y)
		if err != nil {
			return "", err
		}
		_, _, _ = procSetCursorPos.Call(uintptr(sx), uintptr(sy))
		time.Sleep(30 * time.Millisecond)

		downFlag := uintptr(mouseLeftDown)
		upFlag := uintptr(mouseLeftUp)
		if strings.ToLower(call.Button) == "right" {
			downFlag = mouseRightDown
			upFlag = mouseRightUp
		}
		clicks := 1
		if call.Double {
			clicks = 2
		}
		for i := 0; i < clicks; i++ {
			_, _, _ = procMouseEvent.Call(downFlag, 0, 0, 0, 0)
			time.Sleep(25 * time.Millisecond)
			_, _, _ = procMouseEvent.Call(upFlag, 0, 0, 0, 0)
			if i == 0 && clicks == 2 {
				time.Sleep(60 * time.Millisecond)
			}
		}
		return fmt.Sprintf("CLICKED (%d,%d) button=%s double=%v", sx, sy, call.Button, call.Double), nil

	case "MOUSE_DRAG_PATH":
		var ox, oy int32
		if strings.TrimSpace(call.Window) != "" {
			w, err := focusWindow(call.Window)
			if err != nil {
				return "", err
			}
			ox, oy = w.Rect.Left, w.Rect.Top
		}
		strokes := call.Strokes
		if len(strokes) == 0 && len(call.Points) > 0 {
			strokes = [][][]int{call.Points}
		}
		if len(strokes) == 0 {
			return "", fmt.Errorf("MOUSE_DRAG_PATH requires 'strokes' or 'points'")
		}
		stepDelay := time.Duration(call.StepMs) * time.Millisecond
		if stepDelay <= 0 {
			stepDelay = 3 * time.Millisecond
		}
		if stepDelay > 40*time.Millisecond {
			stepDelay = 40 * time.Millisecond
		}

		totalPts := 0
		for _, stroke := range strokes {
			if len(stroke) < 2 {
				continue
			}
			x0 := ox + int32(stroke[0][0])
			y0 := oy + int32(stroke[0][1])
			_, _, _ = procSetCursorPos.Call(uintptr(x0), uintptr(y0))
			time.Sleep(20 * time.Millisecond)
			_, _, _ = procMouseEvent.Call(mouseLeftDown, 0, 0, 0, 0)
			time.Sleep(20 * time.Millisecond)

			for i := 1; i < len(stroke); i++ {
				if len(stroke[i]) < 2 || len(stroke[i-1]) < 2 {
					continue
				}
				ax := float64(ox + int32(stroke[i-1][0]))
				ay := float64(oy + int32(stroke[i-1][1]))
				bx := float64(ox + int32(stroke[i][0]))
				by := float64(oy + int32(stroke[i][1]))
				dist := math.Hypot(bx-ax, by-ay)
				steps := int(dist / 4.0)
				if steps < 1 {
					steps = 1
				}
				for s := 1; s <= steps; s++ {
					t := float64(s) / float64(steps)
					cx := int32(math.Round(ax + (bx-ax)*t))
					cy := int32(math.Round(ay + (by-ay)*t))
					_, _, _ = procSetCursorPos.Call(uintptr(cx), uintptr(cy))
					time.Sleep(stepDelay)
				}
			}
			_, _, _ = procMouseEvent.Call(mouseLeftUp, 0, 0, 0, 0)
			time.Sleep(25 * time.Millisecond)
			totalPts += len(stroke)
		}
		return fmt.Sprintf("DREW %d stroke(s) (%d vertices) on %q", len(strokes), totalPts, call.Window), nil

	case "KEY_TYPE":
		if strings.TrimSpace(call.Window) != "" {
			if _, err := focusWindow(call.Window); err != nil {
				return "", err
			}
		}
		if strings.TrimSpace(call.Hotkey) != "" {
			if err := sendHotkey(call.Hotkey); err != nil {
				return "", err
			}
			return fmt.Sprintf("HOTKEY %s", call.Hotkey), nil
		}
		if call.Text != "" {
			typeUnicodeText(call.Text)
		}
		if call.Enter {
			sendKeyEvent(0x0D, 0, 0)
			time.Sleep(15 * time.Millisecond)
			sendKeyEvent(0x0D, 0, keyeventfKeyUp)
		}
		b, _ := json.Marshal(call.Text)
		return fmt.Sprintf("TYPED %s (enter=%v)", string(b), call.Enter), nil

	case "SCREENSHOT_WIN":
		rel, w, h, err := captureWindowPNG(cwd, call.Window, call.SavePath)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("SCREENSHOT saved to %s (%dx%d) & copied to clipboard (press Ctrl+V in chat)", rel, w, h), nil
	}

	return "", fmt.Errorf("unknown desktop tool: %s", call.Tool)
}
