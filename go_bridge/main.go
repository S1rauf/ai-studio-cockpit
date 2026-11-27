package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
	"golang.org/x/text/encoding/charmap"
)

var startTime = time.Now()

func isAllowedOrigin(origin string) bool {
    if origin == "" {
        return true
    }
    return origin == "https://aistudio.google.com" || strings.HasPrefix(origin, "chrome-extension://")
}

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool {
        return isAllowedOrigin(r.Header.Get("Origin"))
    },
}

type ServerConfig struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	Password   string `json:"password"`
	Key        string `json:"key"`
	PrivateKey string `json:"private_key"`
	IsLocal    bool   `json:"is_local"`
	Cwd        string `json:"cwd"`
}

type ExecReq struct {
	Server  string        `json:"server"`
	Command string        `json:"command"`
	Lang    string        `json:"lang"`
	Cwd     string        `json:"cwd"`
	Config  *ServerConfig `json:"config"`
}

type GitReq struct {
	Server string        `json:"server"`
	Cwd    string        `json:"cwd"`
	Action string        `json:"action"`
	Config *ServerConfig `json:"config"`
}

type BundleReq struct {
	Server string        `json:"server"`
	Cwd    string        `json:"cwd"`
	Config *ServerConfig `json:"config"`
}

type AgentToolCall struct {
	Tool       string    `json:"tool"`
	Path       string    `json:"path"`
	Query      string    `json:"query"`
	Depth      int       `json:"depth"`
	Start      int       `json:"start"`
	End        int       `json:"end"`
	Search     string    `json:"search"`
	Replace    string    `json:"replace"`
	Content    string    `json:"content"`
	Cmd        string    `json:"cmd"`
	Lang       string    `json:"lang"`
	IgnoreCase *bool     `json:"ignore_case"`
	Name       string    `json:"name"`
	Window     string    `json:"window"`
	X          int       `json:"x"`
	Y          int       `json:"y"`
	Button     string    `json:"button"`
	Double     bool      `json:"double"`
	Points     [][]int   `json:"points"`
	Strokes    [][][]int `json:"strokes"`
	StepMs     int       `json:"step_ms"`
	Text       string    `json:"text"`
	Hotkey     string    `json:"hotkey"`
	Enter      bool      `json:"enter"`
	SavePath   string    `json:"save_path"`
}

type AgentRunReq struct {
	Server string          `json:"server"`
	Cwd    string          `json:"cwd"`
	Config *ServerConfig   `json:"config"`
	Tools  []AgentToolCall `json:"tools"`
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        origin := r.Header.Get("Origin")
        if origin != "" {
            if !isAllowedOrigin(origin) {
                http.Error(w, "forbidden origin", http.StatusForbidden)
                return
            }
            w.Header().Set("Access-Control-Allow-Origin", origin)
            w.Header().Set("Vary", "Origin")
        }
        w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Cockpit-Client")

        if r.Method == http.MethodOptions {
            w.WriteHeader(http.StatusOK)
            return
        }
        if r.Method == http.MethodPost && r.Header.Get("X-Cockpit-Client") != "aistudio-cockpit" {
            http.Error(w, "missing client header", http.StatusForbidden)
            return
        }
        next(w, r)
    }
}

func jsonResp(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(data)
}

func decodeLocalOutput(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	if utf8.Valid(raw) {
		return string(raw)
	}
	if decoded, err := charmap.CodePage866.NewDecoder().Bytes(raw); err == nil {
		return string(decoded)
	}
	if decoded, err := charmap.Windows1251.NewDecoder().Bytes(raw); err == nil {
		return string(decoded)
	}
	return string(raw)
}

func isLocalServer(server string) bool {
	u := strings.ToUpper(strings.TrimSpace(server))
	return u == "" || strings.Contains(u, "LOCAL") || strings.Contains(u, "ПК")
}

func escapePosixSingle(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

func isPythonShellCommand(cmdLower string) bool {
	return strings.HasPrefix(cmdLower, "python ") ||
		strings.HasPrefix(cmdLower, "python3 ") ||
		strings.HasPrefix(cmdLower, "py ") ||
		strings.HasPrefix(cmdLower, "pip ") ||
		strings.HasPrefix(cmdLower, "pip3 ")
}

func prepareLocalScript(cmdStr string, lang string) (string, string, string, []string) {
	cmdLower := strings.ToLower(cmdStr)
	isPurePython := (lang == "python" || strings.HasPrefix(cmdLower, "import ") || strings.HasPrefix(cmdLower, "from ") || strings.HasPrefix(cmdLower, "def ")) && !isPythonShellCommand(cmdLower)
	isPS := !isPurePython && (lang == "powershell" ||
		strings.Contains(cmdLower, "write-host") ||
		strings.Contains(cmdLower, "get-") ||
		strings.Contains(cmdLower, "set-") ||
		strings.Contains(cmdLower, "select-object") ||
		strings.Contains(cmdStr, "$") ||
		strings.Contains(cmdLower, "format-table"))

	var ext string
	if isPurePython {
		ext = ".py"
	} else if isPS {
		ext = ".ps1"
	} else {
		ext = ".bat"
	}

	tmpFile := filepath.Join(os.TempDir(), fmt.Sprintf("cockpit_exec_%d%s", time.Now().UnixNano(), ext))
	if isPurePython {
		pyHeader := "# -*- coding: utf-8 -*-\r\nimport sys\r\ntry:\r\n    sys.stdout.reconfigure(encoding='utf-8')\r\n    sys.stderr.reconfigure(encoding='utf-8')\r\nexcept Exception:\r\n    pass\r\n"
		_ = os.WriteFile(tmpFile, []byte(pyHeader+cmdStr), 0644)
		return tmpFile, "python", "", []string{tmpFile}
	} else if isPS {
		bom := []byte{0xEF, 0xBB, 0xBF}
		psContent := append(bom, []byte("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\r\n"+cmdStr)...)
		_ = os.WriteFile(tmpFile, psContent, 0644)
		return tmpFile, "powershell.exe", "", []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmpFile}
	}
	_ = os.WriteFile(tmpFile, []byte("@echo off\r\nchcp 65001 >nul\r\n"+cmdStr), 0644)
	return tmpFile, "cmd.exe", "", []string{"/c", tmpFile}
}

func connectSSH(cfg *ServerConfig) (*ssh.Client, error) {
	if cfg == nil || cfg.Host == "" {
		return nil, fmt.Errorf("не указан IP адрес сервера")
	}
	port := cfg.Port
	if port == 0 {
		port = 22
	}
	user := cfg.User
	if user == "" {
		user = "root"
	}

	var authMethods []ssh.AuthMethod

	keyStr := strings.TrimSpace(cfg.Key)
	if keyStr == "" {
		keyStr = strings.TrimSpace(cfg.PrivateKey)
	}
	if keyStr != "" {
		var keyBytes []byte
		if _, err := os.Stat(keyStr); err == nil {
			keyBytes, _ = os.ReadFile(keyStr)
		} else {
			keyBytes = []byte(keyStr)
		}
		if len(keyBytes) > 0 {
			var signer ssh.Signer
			var err error
			if cfg.Password != "" {
				signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(cfg.Password))
			} else {
				signer, err = ssh.ParsePrivateKey(keyBytes)
			}
			if err == nil {
				authMethods = append(authMethods, ssh.PublicKeys(signer))
			}
		}
	}

	if cfg.Password != "" {
		authMethods = append(authMethods, ssh.Password(cfg.Password))
	}

	sshCfg := &ssh.ClientConfig{
		User:            user,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	return ssh.Dial("tcp", fmt.Sprintf("%s:%d", cfg.Host, port), sshCfg)
}

func runLocalCmd(cwd string, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	if cwd != "" {
		if info, err := os.Stat(cwd); err == nil && info.IsDir() {
			cmd.Dir = cwd
		} else {
			return "", fmt.Errorf("папка не найдена: %s", cwd)
		}
	}
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	}
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	err := cmd.Run()
	out := strings.TrimSpace(decodeLocalOutput(outBuf.Bytes()))
	errOut := strings.TrimSpace(decodeLocalOutput(errBuf.Bytes()))
	if out == "" {
		out = errOut
	} else if errOut != "" && err != nil {
		out = out + "\n" + errOut
	}
	return out, err
}

func runSSHCmd(cfg *ServerConfig, cwd string, command string) (string, error) {
	client, err := connectSSH(cfg)
	if err != nil {
		return "", err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	var outBuf, errBuf bytes.Buffer
	session.Stdout = &outBuf
	session.Stderr = &errBuf

	fullCmd := command
	if strings.TrimSpace(cwd) != "" {
		fullCmd = fmt.Sprintf("cd %s && %s", escapePosixSingle(strings.TrimSpace(cwd)), command)
	}
	runErr := session.Run(fullCmd)
	out := strings.TrimSpace(outBuf.String())
	errOut := strings.TrimSpace(errBuf.String())
	if out == "" {
		out = errOut
	} else if errOut != "" && runErr != nil {
		out = out + "\n" + errOut
	}
	return out, runErr
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	jsonResp(w, map[string]any{
		"status":  "online",
		"backend": "Go Native",
		"uptime":  fmt.Sprintf("%d сек", int(time.Since(startTime).Seconds())),
		"pid":     os.Getpid(),
		"host":    "127.0.0.1:8765",
	})
}

func handleShutdown(w http.ResponseWriter, r *http.Request) {
	jsonResp(w, map[string]string{"status": "ok"})
	go func() {
		time.Sleep(300 * time.Millisecond)
		os.Exit(0)
	}()
}

func handleRestart(w http.ResponseWriter, r *http.Request) {
	jsonResp(w, map[string]string{"status": "restarting"})
	go func() {
		time.Sleep(400 * time.Millisecond)
		exe, _ := os.Executable()
		cmd := exec.Command(exe)
		if runtime.GOOS == "windows" {
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		}
		_ = cmd.Start()
		os.Exit(0)
	}()
}

func handlePickDir(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "windows" {
		jsonResp(w, map[string]any{"ok": false, "error": "Только для Windows"})
		return
	}
	ps := `Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Выберите рабочую папку проекта'
$dlg.ShowNewFolderButton = $true
if ($dlg.ShowDialog($form) -eq 'OK') { Write-Output $dlg.SelectedPath }`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", ps)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf
	_ = cmd.Run()
	picked := strings.TrimSpace(decodeLocalOutput(outBuf.Bytes()))
	jsonResp(w, map[string]any{"ok": picked != "", "path": picked})
}

func handleGitAction(w http.ResponseWriter, r *http.Request) {
	var req GitReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonResp(w, map[string]any{"ok": false, "error": "Неверный JSON"})
		return
	}
	cwd := strings.TrimSpace(req.Cwd)
	if cwd == "" {
		jsonResp(w, map[string]any{"ok": false, "is_git": false, "error": "Не указана папка"})
		return
	}

	local := isLocalServer(req.Server)
	if local {
		if info, err := os.Stat(cwd); err != nil || !info.IsDir() {
			jsonResp(w, map[string]any{"ok": false, "is_git": false, "error": "Папка не найдена"})
			return
		}
	}

	execGit := func(args ...string) (string, error) {
		if local {
			return runLocalCmd(cwd, "git", args...)
		}
		quoted := make([]string, len(args))
		for i, a := range args {
			quoted[i] = escapePosixSingle(a)
		}
		return runSSHCmd(req.Config, cwd, "git "+strings.Join(quoted, " "))
	}

	switch req.Action {
	case "info":
		branch, err := execGit("rev-parse", "--abbrev-ref", "HEAD")
		if err != nil {
			jsonResp(w, map[string]any{"ok": true, "is_git": false})
			return
		}
		st, _ := execGit("status", "--porcelain")
		changed := 0
		if strings.TrimSpace(st) != "" {
			changed = len(strings.Split(strings.TrimSpace(st), "\n"))
		}
		jsonResp(w, map[string]any{
			"ok":      true,
			"is_git":  true,
			"branch":  strings.TrimSpace(branch),
			"changed": changed,
		})
	case "diff":
		st, _ := execGit("status", "-s")
		df, err := execGit("diff")
		staged, _ := execGit("diff", "--cached")
		var parts []string
		if strings.TrimSpace(st) != "" {
			parts = append(parts, "# Status:\n"+st)
		}
		if strings.TrimSpace(staged) != "" {
			parts = append(parts, "# Staged:\n"+staged)
		}
		if strings.TrimSpace(df) != "" {
			parts = append(parts, "# Working tree:\n"+df)
		}
		fullDiff := strings.Join(parts, "\n\n")
		if len(fullDiff) > 60000 {
			fullDiff = fullDiff[:60000] + "\n... [обрезано до 60 КБ]"
		}
		if err != nil && fullDiff == "" {
			jsonResp(w, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		jsonResp(w, map[string]any{"ok": true, "diff": fullDiff})
	case "rollback":
		out, err := execGit("checkout", "--", ".")
		if err != nil {
			jsonResp(w, map[string]any{"ok": false, "error": out + " " + err.Error()})
			return
		}
		if out == "" {
			out = "Изменения отслеживаемых файлов откачены."
		}
		jsonResp(w, map[string]any{"ok": true, "output": out})
	default:
		jsonResp(w, map[string]any{"ok": false, "error": "Неизвестное действие"})
	}
}

var agentSkipDirs = map[string]bool{
	".git": true, "node_modules": true, "dist": true, "build": true,
	"__pycache__": true, "venv": true, ".venv": true, ".next": true,
	"target": true, ".idea": true, ".vscode": true,
}

var agentSkipExts = map[string]bool{
	".exe": true, ".dll": true, ".so": true, ".dylib": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
	".ico": true, ".webp": true, ".zip": true, ".tar": true,
	".gz": true, ".7z": true, ".pdf": true, ".woff": true,
	".woff2": true, ".ttf": true, ".lock": true, ".bin": true,
	".pem": true, ".key": true, ".p12": true, ".pfx": true,
}

func isProtectedSecretFile(name string) bool {
	lower := strings.ToLower(filepath.Base(name))
	if lower == ".env" || strings.HasPrefix(lower, ".env.") ||
		lower == "id_rsa" || lower == "id_ed25519" ||
		strings.HasPrefix(lower, "id_rsa.") || strings.HasPrefix(lower, "id_ed25519.") {
		return true
	}
	ext := strings.ToLower(filepath.Ext(lower))
	return ext == ".pem" || ext == ".key" || ext == ".p12" || ext == ".pfx"
}

func resolveSafePath(cwd, relPath string) (string, error) {
	if strings.TrimSpace(cwd) == "" {
		return "", fmt.Errorf("working directory (cwd) is not set")
	}
	absCwd, err := filepath.Abs(cwd)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(absCwd)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("working directory not found: %s", absCwd)
	}
	p := strings.TrimSpace(relPath)
	if p == "" || p == "." {
		return absCwd, nil
	}
	var candidate string
	if filepath.IsAbs(p) {
		candidate = filepath.Clean(p)
	} else {
		candidate = filepath.Join(absCwd, p)
	}
	absTarget, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(absCwd, absTarget)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("access denied outside working directory: %s", relPath)
	}
	return absTarget, nil
}

func countBracesSafe(line string) int {
	delta := 0
	var quote byte
	escaped := false
	for i := 0; i < len(line); i++ {
		c := line[i]
		if quote != 0 {
			if escaped {
				escaped = false
				continue
			}
			if c == '\\' {
				escaped = true
				continue
			}
			if c == quote {
				quote = 0
			}
			continue
		}
		if c == '/' && i+1 < len(line) && line[i+1] == '/' {
			break
		}
		if c == '"' || c == '\'' || c == '`' {
			quote = c
			continue
		}
		if c == '{' {
			delta++
		} else if c == '}' {
			delta--
		}
	}
	return delta
}

func lintLocalFile(cwd, absPath string) (string, error) {
	ext := strings.ToLower(filepath.Ext(absPath))
	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", err
	}

	switch ext {
	case ".json":
		var v any
		if err := json.Unmarshal(data, &v); err != nil {
			line := 1
			if se, ok := err.(*json.SyntaxError); ok {
				offset := int(se.Offset)
				if offset > len(data) {
					offset = len(data)
				}
				line = 1 + bytes.Count(data[:offset], []byte("\n"))
			}
			return "", fmt.Errorf("JSON syntax error (line ~%d): %v", line, err)
		}
		return "LINT OK (JSON)", nil

	case ".go":
		if _, err := exec.LookPath("gofmt"); err == nil {
			out, runErr := runLocalCmd(cwd, "gofmt", "-e", absPath)
			if runErr != nil {
				return "", fmt.Errorf("Go syntax error:\n%s", out)
			}
			return "LINT OK (Go gofmt)", nil
		}
		return "LINT SKIP (gofmt not found)", nil

	case ".js", ".mjs", ".cjs":
		if _, err := exec.LookPath("node"); err == nil {
			out, runErr := runLocalCmd(cwd, "node", "--check", absPath)
			if runErr != nil {
				return "", fmt.Errorf("JS syntax error:\n%s", out)
			}
			return "LINT OK (Node --check)", nil
		}
		return "LINT SKIP (node not found)", nil

	case ".py":
		pyBin := "python"
		if _, err := exec.LookPath("python"); err != nil {
			if _, err3 := exec.LookPath("python3"); err3 == nil {
				pyBin = "python3"
			} else {
				return "LINT SKIP (python not found)", nil
			}
		}
		out, runErr := runLocalCmd(cwd, pyBin, "-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read(), filename=sys.argv[1])", absPath)
		if runErr != nil {
			return "", fmt.Errorf("Python syntax error:\n%s", out)
		}
		return "LINT OK (Python AST)", nil

	case ".ps1":
		if runtime.GOOS == "windows" {
			esc := strings.ReplaceAll(absPath, "'", "''")
			ps := fmt.Sprintf(`$errs=$null; [System.Management.Automation.Language.Parser]::ParseFile('%s',[ref]$null,[ref]$errs) | Out-Null; if($errs.Count -gt 0){ $errs | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }; exit 1 }`, esc)
			out, runErr := runLocalCmd(cwd, "powershell.exe", "-NoProfile", "-Command", ps)
			if runErr != nil {
				return "", fmt.Errorf("PowerShell syntax error:\n%s", out)
			}
			return "LINT OK (PowerShell AST)", nil
		}
		return "LINT SKIP", nil

	case ".yaml", ".yml":
		if _, err := exec.LookPath("python"); err == nil {
			out, runErr := runLocalCmd(cwd, "python", "-c", "import sys\ntry:\n import yaml\n yaml.safe_load(open(sys.argv[1], encoding='utf-8'))\nexcept ImportError:\n sys.exit(42)", absPath)
			if runErr == nil {
				return "LINT OK (PyYAML)", nil
			}
			if !strings.Contains(runErr.Error(), "42") && out != "" {
				return "", fmt.Errorf("YAML error:\n%s", out)
			}
		}
		lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
		for idx, l := range lines {
			if strings.HasPrefix(l, "\t") || strings.Contains(strings.TrimLeft(l, " "), "\t") && strings.HasPrefix(strings.TrimSpace(l), "-") {
				return "", fmt.Errorf("YAML error (line %d): tabs are not allowed for YAML indentation", idx+1)
			}
		}
		return "LINT OK (YAML basic)", nil
	}

	return "LINT OK", nil
}

func buildFileOutline(relPath string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(relPath))
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")

	type item struct {
		start int
		end   int
		label string
		desc  string
	}
	var items []item

	reGo := regexp.MustCompile(`^(func\s+(?:\([^)]+\)\s+)?[A-Za-z0-9_]+\([^)]*\)|type\s+[A-Za-z0-9_]+\s+(?:struct|interface))`)
	reJS := regexp.MustCompile(`^\s{0,4}(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z0-9_$]+)|class\s+([A-Za-z0-9_$]+)|([A-Za-z0-9_$]+)\s*:\s*(?:async\s+)?function\s*\(|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)`)
	rePy := regexp.MustCompile(`^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z0-9_]+)`)
	rePS := regexp.MustCompile(`^\s*(?:function|filter)\s+([A-Za-z0-9_-]+)`)

	findDesc := func(idx int) string {
		for k := idx - 1; k >= 0 && k >= idx-2; k-- {
			t := strings.TrimSpace(lines[k])
			if t == "" {
				continue
			}
			if strings.HasPrefix(t, "//") || strings.HasPrefix(t, "#") || strings.HasPrefix(t, "/*") {
				c := strings.TrimSpace(strings.TrimLeft(t, "/#* "))
				if len(c) > 70 {
					c = c[:70] + "..."
				}
				return c
			}
			break
		}
		return ""
	}

	if ext == ".py" {
		for i := 0; i < len(lines); i++ {
			m := rePy.FindStringSubmatch(lines[i])
			if m == nil {
				continue
			}
			indent := len(m[1])
			end := i + 1
			for j := i + 1; j < len(lines); j++ {
				tr := strings.TrimSpace(lines[j])
				if tr == "" || strings.HasPrefix(tr, "#") {
					continue
				}
				curIndent := len(lines[j]) - len(strings.TrimLeft(lines[j], " \t"))
				if curIndent <= indent {
					break
				}
				end = j + 1
			}
			items = append(items, item{start: i + 1, end: end, label: fmt.Sprintf("%s %s", m[2], m[3]), desc: findDesc(i)})
		}
	} else {
		for i := 0; i < len(lines); i++ {
			line := lines[i]
			tr := strings.TrimSpace(line)
			if strings.HasPrefix(tr, "// ===") || strings.HasPrefix(tr, "# ===") {
				items = append(items, item{start: i + 1, end: i + 1, label: tr})
				continue
			}
			matched := ""
			switch ext {
			case ".go":
				if m := reGo.FindStringSubmatch(line); m != nil {
					matched = m[1]
				}
			case ".js", ".mjs", ".ts", ".tsx", ".jsx":
				if m := reJS.FindStringSubmatch(line); m != nil {
					matched = strings.TrimSpace(tr)
					if len(matched) > 65 {
						matched = matched[:65] + "..."
					}
				}
			case ".ps1":
				if m := rePS.FindStringSubmatch(line); m != nil {
					matched = "function " + m[1]
				}
			}
			if matched == "" {
				continue
			}
			depth := countBracesSafe(line)
			end := i + 1
			if depth > 0 {
				for j := i + 1; j < len(lines); j++ {
					depth += countBracesSafe(lines[j])
					end = j + 1
					if depth <= 0 {
						break
					}
				}
			}
			items = append(items, item{start: i + 1, end: end, label: matched, desc: findDesc(i)})
		}
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Outline: %s (%d lines)\n", relPath, len(lines)))
	if len(items) == 0 {
		sb.WriteString("(no top-level functions/blocks detected; use READ_LINES)")
		return sb.String()
	}
	for _, it := range items {
		if it.start == it.end {
			sb.WriteString(fmt.Sprintf("L%-4d      | %s\n", it.start, it.label))
		} else if it.desc != "" {
			sb.WriteString(fmt.Sprintf("L%-4d-L%-4d | %s  // %s\n", it.start, it.end, it.label, it.desc))
		} else {
			sb.WriteString(fmt.Sprintf("L%-4d-L%-4d | %s\n", it.start, it.end, it.label))
		}
	}
	return strings.TrimRight(sb.String(), "\n")
}

func handleBundle(w http.ResponseWriter, r *http.Request) {
	var req BundleReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonResp(w, map[string]any{"ok": false, "error": "Неверный JSON"})
		return
	}
	cwd := strings.TrimSpace(req.Cwd)
	if cwd == "" {
		jsonResp(w, map[string]any{"ok": false, "error": "Укажите рабочую папку"})
		return
	}

	if !isLocalServer(req.Server) {
		sh := `find . -maxdepth 5 -type f ! -path '*/.git/*' ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/build/*' ! -path '*/__pycache__/*' ! -path '*/.venv/*' ! -path '*/venv/*' ! -name '.env*' ! -name '*.pem' ! -name '*.key' ! -name 'id_rsa*' ! -name 'id_ed25519*' ! -name '*.lock' ! -name 'package-lock.json' ! -name 'go.sum' ! -name '*.exe' ! -name '*.png' ! -name '*.jpg' ! -name '*.ico' ! -name '*.zip' | sort | head -n 120 | while IFS= read -r f; do echo "=== $f ==="; head -c 32768 "$f"; echo ""; done`
		out, err := runSSHCmd(req.Config, cwd, sh)
		if err != nil && out == "" {
			jsonResp(w, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		if len(out) > 400000 {
			out = out[:400000] + "\n... [обрезано до 400 КБ]"
		}
		jsonResp(w, map[string]any{
			"ok":          true,
			"files_count": strings.Count(out, "=== "),
			"size_kb":     fmt.Sprintf("%.1f", float64(len(out))/1024.0),
			"bundle":      out,
		})
		return
	}

	info, err := os.Stat(cwd)
	if err != nil || !info.IsDir() {
		jsonResp(w, map[string]any{"ok": false, "error": "Папка не найдена: " + cwd})
		return
	}

	skipNames := map[string]bool{
		"go.sum": true, "package-lock.json": true, "yarn.lock": true,
		"pnpm-lock.yaml": true, "project_code.txt": true,
	}

	var sb strings.Builder
	filesCount := 0
	const maxTotal = 450 * 1024

	_ = filepath.WalkDir(cwd, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		name := d.Name()
		lower := strings.ToLower(name)
		if d.IsDir() {
			if path != cwd && agentSkipDirs[lower] {
				return filepath.SkipDir
			}
			return nil
		}
		if skipNames[lower] || isProtectedSecretFile(name) {
			return nil
		}
		if agentSkipExts[strings.ToLower(filepath.Ext(name))] {
			return nil
		}
		fi, err := d.Info()
		if err != nil || fi.Size() > 128*1024 {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil || !utf8.Valid(data) {
			return nil
		}
		if sb.Len()+len(data) > maxTotal {
			return fs.SkipAll
		}
		rel, _ := filepath.Rel(cwd, path)
		sb.WriteString("=== ")
		sb.WriteString(rel)
		sb.WriteString(" ===\n")
		sb.Write(data)
		if !bytes.HasSuffix(data, []byte("\n")) {
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
		filesCount++
		return nil
	})

	bundle := sb.String()
	jsonResp(w, map[string]any{
		"ok":          true,
		"files_count": filesCount,
		"size_kb":     fmt.Sprintf("%.1f", float64(len(bundle))/1024.0),
		"bundle":      bundle,
	})
}

func runLocalAgentTool(cwd string, call AgentToolCall) (string, error) {
	tool := strings.ToUpper(strings.TrimSpace(call.Tool))
	switch tool {
	case "TREE":
		target, err := resolveSafePath(cwd, call.Path)
		if err != nil {
			return "", err
		}
		maxDepth := call.Depth
		if maxDepth <= 0 {
			maxDepth = 3
		}
		if maxDepth > 6 {
			maxDepth = 6
		}
		var entries []string
		_ = filepath.WalkDir(target, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if path == target {
				return nil
			}
			rel, _ := filepath.Rel(target, path)
			depth := strings.Count(rel, string(filepath.Separator)) + 1
			name := d.Name()
			if d.IsDir() {
				if agentSkipDirs[strings.ToLower(name)] {
					return filepath.SkipDir
				}
				entries = append(entries, strings.Repeat("  ", depth-1)+"📁 "+filepath.ToSlash(rel)+"/")
				if depth >= maxDepth {
					return filepath.SkipDir
				}
				return nil
			}
			if len(entries) >= 250 {
				return fs.SkipAll
			}
			fi, _ := d.Info()
			sz := int64(0)
			if fi != nil {
				sz = fi.Size()
			}
			entries = append(entries, fmt.Sprintf("%s📄 %s (%d B)", strings.Repeat("  ", depth-1), filepath.ToSlash(rel), sz))
			return nil
		})
		if len(entries) == 0 {
			return "(empty directory)", nil
		}
		return strings.Join(entries, "\n"), nil

	case "OUTLINE":
		target, err := resolveSafePath(cwd, call.Path)
		if err != nil {
			return "", err
		}
		if isProtectedSecretFile(target) {
			return "", fmt.Errorf("access denied to protected secret file: %s", call.Path)
		}
		data, err := os.ReadFile(target)
		if err != nil {
			return "", err
		}
		if !utf8.Valid(data) {
			return "", fmt.Errorf("binary or non-UTF8 file: %s", call.Path)
		}
		return buildFileOutline(call.Path, data), nil

	case "CHECK_FILE":
		target, err := resolveSafePath(cwd, call.Path)
		if err != nil {
			return "", err
		}
		if isProtectedSecretFile(target) {
			return "", fmt.Errorf("access denied to protected secret file: %s", call.Path)
		}
		return lintLocalFile(cwd, target)

	case "GREP":
		q := call.Query
		if q == "" {
			return "", fmt.Errorf("GREP requires non-empty 'query'")
		}
		target, err := resolveSafePath(cwd, call.Path)
		if err != nil {
			return "", err
		}
		ignoreCase := true
		if call.IgnoreCase != nil {
			ignoreCase = *call.IgnoreCase
		}
		qCmp := q
		if ignoreCase {
			qCmp = strings.ToLower(q)
		}
		var hits []string
		_ = filepath.WalkDir(target, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			name := d.Name()
			if d.IsDir() {
				if path != target && agentSkipDirs[strings.ToLower(name)] {
					return filepath.SkipDir
				}
				return nil
			}
			if isProtectedSecretFile(name) || agentSkipExts[strings.ToLower(filepath.Ext(name))] {
				return nil
			}
			fi, err := d.Info()
			if err != nil || fi.Size() > 512*1024 {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil || !utf8.Valid(data) {
				return nil
			}
			rel, _ := filepath.Rel(cwd, path)
			scanner := bufio.NewScanner(bytes.NewReader(data))
			lineNum := 0
			for scanner.Scan() {
				lineNum++
				line := scanner.Text()
				hay := line
				if ignoreCase {
					hay = strings.ToLower(line)
				}
				if strings.Contains(hay, qCmp) {
					trimmed := strings.TrimSpace(line)
					if len(trimmed) > 180 {
						trimmed = trimmed[:180] + "..."
					}
					hits = append(hits, fmt.Sprintf("%s:%d: %s", filepath.ToSlash(rel), lineNum, trimmed))
					if len(hits) >= 60 {
						return fs.SkipAll
					}
				}
			}
			return nil
		})
		if len(hits) == 0 {
			return fmt.Sprintf("No matches for %q", q), nil
		}
		return strings.Join(hits, "\n"), nil

	case "READ_LINES":
		target, err := resolveSafePath(cwd, call.Path)
		if err != nil {
			return "", err
		}
		if isProtectedSecretFile(target) {
			return "", fmt.Errorf("access denied to protected secret file: %s", call.Path)
		}
		data, err := os.ReadFile(target)
		if err != nil {
			return "", err
		}
		if !utf8.Valid(data) {
			return "", fmt.Errorf("binary or non-UTF8 file: %s", call.Path)
		}
		lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
		start := call.Start
		if start < 1 {
			start = 1
		}
		end := call.End
		if end < start {
			end = start + 119
		}
		if end-start+1 > 250 {
			end = start + 249
		}
		if start > len(lines) {
			return fmt.Sprintf("File %s has only %d lines (requested start=%d).", call.Path, len(lines), start), nil
		}
		if end > len(lines) {
			end = len(lines)
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("File: %s (lines %d-%d of %d)\n", call.Path, start, end, len(lines)))
		for i := start; i <= end; i++ {
			sb.WriteString(fmt.Sprintf("%4d | %s\n", i, lines[i-1]))
		}
		return strings.TrimRight(sb.String(), "\n"), nil

	case "REPLACE_LINES":
		target, err := resolveSafePath(cwd, call.Path)
		if err != nil {
			return "", err
		}
		if isProtectedSecretFile(target) {
			return "", fmt.Errorf("access denied to protected secret file: %s", call.Path)
		}
		raw, err := os.ReadFile(target)
		if err != nil {
			return "", err
		}
		orig := string(raw)
		useCRLF := strings.Contains(orig, "\r\n")
		lines := strings.Split(strings.ReplaceAll(orig, "\r\n", "\n"), "\n")
		if call.Start < 1 || call.End < call.Start || call.End > len(lines) {
			return "", fmt.Errorf("invalid line range %d-%d for %s (%d lines)", call.Start, call.End, call.Path, len(lines))
		}
		replText := strings.ReplaceAll(call.Content, "\r\n", "\n")
		if replText == "" {
			replText = strings.ReplaceAll(call.Replace, "\r\n", "\n")
		}
		replLines := strings.Split(strings.TrimSuffix(replText, "\n"), "\n")
		newLines := make([]string, 0, len(lines)-(call.End-call.Start+1)+len(replLines))
		newLines = append(newLines, lines[:call.Start-1]...)
		newLines = append(newLines, replLines...)
		newLines = append(newLines, lines[call.End:]...)
		updated := strings.Join(newLines, "\n")
		if useCRLF {
			updated = strings.ReplaceAll(updated, "\n", "\r\n")
		}
		if err := os.WriteFile(target, []byte(updated), 0644); err != nil {
			return "", err
		}
		lintMsg, lintErr := lintLocalFile(cwd, target)
		msg := fmt.Sprintf("REPLACED lines %d-%d in %s (%d new lines)\n%s", call.Start, call.End, call.Path, len(replLines), lintMsg)
		if lintErr != nil {
			return fmt.Sprintf("REPLACED lines %d-%d in %s", call.Start, call.End, call.Path), lintErr
		}
		return msg, nil

	case "PATCH_FILE":
		target, err := resolveSafePath(cwd, call.Path)
		if err != nil {
			return "", err
		}
		if isProtectedSecretFile(target) {
			return "", fmt.Errorf("access denied to protected secret file: %s", call.Path)
		}
		if call.Search == "" {
			return "", fmt.Errorf("PATCH_FILE requires non-empty 'search'")
		}
		raw, err := os.ReadFile(target)
		if err != nil {
			return "", err
		}
		orig := string(raw)
		useCRLF := strings.Contains(orig, "\r\n")
		normOrig := strings.ReplaceAll(orig, "\r\n", "\n")
		normSearch := strings.ReplaceAll(call.Search, "\r\n", "\n")
		normReplace := strings.ReplaceAll(call.Replace, "\r\n", "\n")

		cnt := strings.Count(normOrig, normSearch)
		if cnt == 0 {
			return "", fmt.Errorf("SEARCH block not found in %s. Use READ_LINES first and provide exact text.", call.Path)
		}
		if cnt > 1 {
			return "", fmt.Errorf("SEARCH block matched %d times in %s. Include more surrounding lines so it is unique.", cnt, call.Path)
		}
		updated := strings.Replace(normOrig, normSearch, normReplace, 1)
		if useCRLF {
			updated = strings.ReplaceAll(updated, "\n", "\r\n")
		}
		if err := os.WriteFile(target, []byte(updated), 0644); err != nil {
			return "", err
		}
		lintMsg, lintErr := lintLocalFile(cwd, target)
		if lintErr != nil {
			return fmt.Sprintf("PATCHED %s (1 unique match replaced)", call.Path), lintErr
		}
		return fmt.Sprintf("PATCHED %s (1 unique match replaced)\n%s", call.Path, lintMsg), nil

	case "WRITE_FILE":
		target, err := resolveSafePath(cwd, call.Path)
		if err != nil {
			return "", err
		}
		if isProtectedSecretFile(target) {
			return "", fmt.Errorf("access denied to protected secret file: %s", call.Path)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return "", err
		}
		if err := os.WriteFile(target, []byte(call.Content), 0644); err != nil {
			return "", err
		}
		lintMsg, lintErr := lintLocalFile(cwd, target)
		if lintErr != nil {
			return fmt.Sprintf("WROTE %s (%d bytes)", call.Path, len(call.Content)), lintErr
		}
		return fmt.Sprintf("WROTE %s (%d bytes)\n%s", call.Path, len(call.Content), lintMsg), nil

	case "RUN_CMD":
		if strings.TrimSpace(call.Cmd) == "" {
			return "", fmt.Errorf("RUN_CMD requires 'cmd'")
		}
		lang := strings.ToLower(strings.TrimSpace(call.Lang))
		if lang == "" {
			lang = "shell"
		}
		tmpFile, binName, _, args := prepareLocalScript(call.Cmd, lang)
		defer os.Remove(tmpFile)
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		c := exec.CommandContext(ctx, binName, args...)
		c.Dir = cwd
		if runtime.GOOS == "windows" {
			c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		}
		var outBuf, errBuf bytes.Buffer
		c.Stdout = &outBuf
		c.Stderr = &errBuf
		runErr := c.Run()
		out := strings.TrimSpace(decodeLocalOutput(outBuf.Bytes()))
		errOut := strings.TrimSpace(decodeLocalOutput(errBuf.Bytes()))
		combined := strings.TrimSpace(strings.Join([]string{out, errOut}, "\n"))
		if combined == "" {
			combined = "(no output)"
		}
		if runErr != nil {
			return combined, fmt.Errorf("command failed: %v", runErr)
		}
		return combined, nil

	case "UIA_CLICK", "WIN_LIST", "WIN_FOCUS", "UI_TREE", "MOUSE_CLICK", "MOUSE_DRAG_PATH", "KEY_TYPE", "SCREENSHOT_WIN":
		return runDesktopTool(cwd, call)

	default:
		return "", fmt.Errorf("unknown tool: %s", call.Tool)
	}
}

func runSSHAgentTool(cfg *ServerConfig, cwd string, call AgentToolCall) (string, error) {
	if strings.TrimSpace(cwd) == "" {
		return "", fmt.Errorf("working directory (cwd) is not set")
	}
	if strings.Contains(call.Path, "..") {
		return "", fmt.Errorf("invalid path: %s", call.Path)
	}
	if call.Path != "" && isProtectedSecretFile(call.Path) {
		return "", fmt.Errorf("access denied to protected secret file: %s", call.Path)
	}

	tool := strings.ToUpper(strings.TrimSpace(call.Tool))
	switch tool {
	case "TREE":
		p := call.Path
		if p == "" {
			p = "."
		}
		depth := call.Depth
		if depth <= 0 || depth > 6 {
			depth = 3
		}
		sh := fmt.Sprintf(`find %s -maxdepth %d ! -path '*/.git*' ! -path '*/node_modules*' ! -path '*/__pycache__*' ! -path '*/.venv*' | sort | head -n 220`, escapePosixSingle(p), depth)
		return runSSHCmd(cfg, cwd, sh)
	case "OUTLINE":
		sh := fmt.Sprintf(`grep -nE '^(func |type |class |def |async def |function )|// ===|# ===' %s | head -n 120`, escapePosixSingle(call.Path))
		return runSSHCmd(cfg, cwd, sh)
	case "CHECK_FILE":
		p := escapePosixSingle(call.Path)
		ext := strings.ToLower(filepath.Ext(call.Path))
		switch ext {
		case ".json":
			return runSSHCmd(cfg, cwd, fmt.Sprintf(`python3 -m json.tool %s >/dev/null && echo "LINT OK (JSON)"`, p))
		case ".py":
			return runSSHCmd(cfg, cwd, fmt.Sprintf(`python3 -c "import ast,sys; ast.parse(open(%s).read())" && echo "LINT OK (Python AST)"`, p))
		case ".js":
			return runSSHCmd(cfg, cwd, fmt.Sprintf(`node --check %s && echo "LINT OK (Node)"`, p))
		case ".go":
			return runSSHCmd(cfg, cwd, fmt.Sprintf(`gofmt -e %s >/dev/null && echo "LINT OK (Go)"`, p))
		default:
			return "LINT SKIP (SSH)", nil
		}
	case "GREP":
		if call.Query == "" {
			return "", fmt.Errorf("GREP requires 'query'")
		}
		p := call.Path
		if p == "" {
			p = "."
		}
		sh := fmt.Sprintf(`grep -rnI --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv --exclude='.env*' --exclude='*.pem' --exclude='*.key' -F %s %s | head -n 60`, escapePosixSingle(call.Query), escapePosixSingle(p))
		out, err := runSSHCmd(cfg, cwd, sh)
		if err != nil && out == "" {
			return fmt.Sprintf("No matches for %q", call.Query), nil
		}
		return out, nil
	case "READ_LINES":
		start := call.Start
		if start < 1 {
			start = 1
		}
		end := call.End
		if end < start {
			end = start + 119
		}
		if end-start+1 > 250 {
			end = start + 249
		}
		sh := fmt.Sprintf(`sed -n '%d,%dp' %s | nl -ba -v %d`, start, end, escapePosixSingle(call.Path), start)
		return runSSHCmd(cfg, cwd, sh)
	case "REPLACE_LINES":
		txt := call.Content
		if txt == "" {
			txt = call.Replace
		}
		bRepl := base64.StdEncoding.EncodeToString([]byte(txt))
		py := fmt.Sprintf(`python3 -c "import base64; p=%s; ls=open(p,'r',encoding='utf-8').read().splitlines(); r=base64.b64decode('%s').decode().splitlines(); open(p,'w',encoding='utf-8').write('\n'.join(ls[:%d]+r+ls[%d:])+'\n'); print('REPLACED', p)"`, escapePosixSingle(call.Path), bRepl, call.Start-1, call.End)
		return runSSHCmd(cfg, cwd, py)
	case "PATCH_FILE":
		bSearch := base64.StdEncoding.EncodeToString([]byte(call.Search))
		bRepl := base64.StdEncoding.EncodeToString([]byte(call.Replace))
		py := fmt.Sprintf(`python3 -c "import base64,sys; p=%s; s=base64.b64decode('%s').decode(); r=base64.b64decode('%s').decode(); t=open(p,'r',encoding='utf-8').read(); c=t.count(s); assert c==1, f'Match count={c}'; open(p,'w',encoding='utf-8').write(t.replace(s,r,1)); print('PATCHED', p)"`, escapePosixSingle(call.Path), bSearch, bRepl)
		return runSSHCmd(cfg, cwd, py)
	case "WRITE_FILE":
		bCont := base64.StdEncoding.EncodeToString([]byte(call.Content))
		py := fmt.Sprintf(`python3 -c "import base64,os; p=%s; os.makedirs(os.path.dirname(p) or '.', exist_ok=True); d=base64.b64decode('%s'); open(p,'wb').write(d); print('WROTE', p, len(d), 'bytes')"`, escapePosixSingle(call.Path), bCont)
		return runSSHCmd(cfg, cwd, py)
	case "RUN_CMD":
		return runSSHCmd(cfg, cwd, call.Cmd)
	case "UIA_CLICK", "WIN_LIST", "WIN_FOCUS", "UI_TREE", "MOUSE_CLICK", "MOUSE_DRAG_PATH", "KEY_TYPE", "SCREENSHOT_WIN":
		return runDesktopTool(cwd, call)

	default:
		return "", fmt.Errorf("unknown tool: %s", call.Tool)
	}
}

func handleAgentRun(w http.ResponseWriter, r *http.Request) {
	var req AgentRunReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonResp(w, map[string]any{"status": "fail", "error": "Неверный JSON"})
		return
	}
	cwd := strings.TrimSpace(req.Cwd)
	if cwd == "" {
		jsonResp(w, map[string]any{"status": "fail", "output": "Ошибка: выберите рабочую папку (Working Dir) в панели Терминал!", "error": "cwd is empty"})
		return
	}
	if len(req.Tools) == 0 {
		jsonResp(w, map[string]any{"status": "fail", "output": "Список операций пуст."})
		return
	}

	local := isLocalServer(req.Server)
	var outputs []string
	overallStatus := "ok"
	readOnly := true

	for i, call := range req.Tools {
		tUpper := strings.ToUpper(strings.TrimSpace(call.Tool))
		if tUpper != "TREE" && tUpper != "GREP" && tUpper != "READ_LINES" && tUpper != "OUTLINE" && tUpper != "CHECK_FILE" && tUpper != "WIN_LIST" && tUpper != "UI_TREE" {
			readOnly = false
		}
		var out string
		var err error
		if local {
			out, err = runLocalAgentTool(cwd, call)
		} else {
			out, err = runSSHAgentTool(req.Config, cwd, call)
		}
		header := fmt.Sprintf("### [%d] %s %s", i+1, tUpper, call.Path)
		if err != nil {
			overallStatus = "fail"
			msg := out
			if msg != "" {
				msg += "\n"
			}
			msg += "ERROR: " + err.Error()
			outputs = append(outputs, header+"\n"+msg)
			break
		}
		outputs = append(outputs, header+"\n"+out)
	}

	jsonResp(w, map[string]any{
		"status":    overallStatus,
		"read_only": readOnly,
		"output":    strings.Join(outputs, "\n\n"),
	})
}

func handleExec(w http.ResponseWriter, r *http.Request) {
	var req ExecReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonResp(w, map[string]string{"error": "Неверный JSON", "status": "fail"})
		return
	}

	cmdStr := strings.TrimSpace(req.Command)
	cmdLower := strings.ToLower(cmdStr)
	lang := strings.ToLower(req.Lang)
	cwd := strings.TrimSpace(req.Cwd)

	isPurePython := (lang == "python" || strings.HasPrefix(cmdLower, "import ") || strings.HasPrefix(cmdLower, "from ") || strings.HasPrefix(cmdLower, "def ")) && !isPythonShellCommand(cmdLower)

	if isLocalServer(req.Server) {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		tmpFile, binName, _, args := prepareLocalScript(cmdStr, lang)
		defer os.Remove(tmpFile)

		cmd := exec.CommandContext(ctx, binName, args...)
		if cwd != "" {
			if info, err := os.Stat(cwd); err == nil && info.IsDir() {
				cmd.Dir = cwd
			}
		}
		if runtime.GOOS == "windows" {
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		}

		var outBuf, errBuf bytes.Buffer
		cmd.Stdout = &outBuf
		cmd.Stderr = &errBuf

		runErr := cmd.Run()
		out := strings.TrimSpace(decodeLocalOutput(outBuf.Bytes()))
		errOut := strings.TrimSpace(decodeLocalOutput(errBuf.Bytes()))

		var parts []string
		if out != "" {
			parts = append(parts, out)
		}
		if errOut != "" {
			parts = append(parts, errOut)
		}
		resText := strings.Join(parts, "\n")

		if resText == "" {
			if ctx.Err() == context.DeadlineExceeded {
				resText = "Ошибка: превышен таймаут выполнения (60 сек)."
			} else if runErr != nil {
				resText = "Ошибка выполнения: " + runErr.Error()
			} else {
				resText = "Команда выполнена успешно."
			}
		}
		status := "ok"
		if runErr != nil && out == "" {
			status = "fail"
		}
		jsonResp(w, map[string]string{"output": resText, "status": status})
		return
	}

	remoteCmd := cmdStr
	if isPurePython {
		remoteCmd = fmt.Sprintf("python3 - << 'COCKPIT_PY_EOF'\n%s\nCOCKPIT_PY_EOF", cmdStr)
	}
	resText, runErr := runSSHCmd(req.Config, cwd, remoteCmd)
	if resText == "" {
		if runErr != nil {
			resText = "Ошибка SSH: " + runErr.Error()
		} else {
			resText = "Успешно (вывод пуст)."
		}
	}
	status := "ok"
	if runErr != nil {
		status = "fail"
	}
	jsonResp(w, map[string]string{"output": resText, "status": status})
}

func safeWSWriteJSON(mu *sync.Mutex, ws *websocket.Conn, v any) {
	mu.Lock()
	defer mu.Unlock()
	_ = ws.WriteJSON(v)
}

func handleWSExec(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	var req ExecReq
	if err := ws.ReadJSON(&req); err != nil {
		return
	}

	var wsMu sync.Mutex
	cmdStr := strings.TrimSpace(req.Command)
	cmdLower := strings.ToLower(cmdStr)
	lang := strings.ToLower(req.Lang)
	cwd := strings.TrimSpace(req.Cwd)
	isPurePython := (lang == "python" || strings.HasPrefix(cmdLower, "import ") || strings.HasPrefix(cmdLower, "from ") || strings.HasPrefix(cmdLower, "def ")) && !isPythonShellCommand(cmdLower)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	var stopFn func()
	stoppedByUser := false
	var stopMu sync.Mutex

	go func() {
		for {
			var ctrl map[string]string
			if err := ws.ReadJSON(&ctrl); err != nil {
				cancel()
				return
			}
			if ctrl["type"] == "stop" {
				stopMu.Lock()
				stoppedByUser = true
				fn := stopFn
				stopMu.Unlock()
				cancel()
				if fn != nil {
					fn()
				}
				return
			}
		}
	}()

	if isLocalServer(req.Server) {
		tmpFile, binName, _, args := prepareLocalScript(cmdStr, lang)
		defer os.Remove(tmpFile)

		cmd := exec.CommandContext(ctx, binName, args...)
		if cwd != "" {
			if info, err := os.Stat(cwd); err == nil && info.IsDir() {
				cmd.Dir = cwd
			}
		}
		if runtime.GOOS == "windows" {
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		}

		stdout, _ := cmd.StdoutPipe()
		stderr, _ := cmd.StderrPipe()

		if err := cmd.Start(); err != nil {
			safeWSWriteJSON(&wsMu, ws, map[string]any{"type": "err", "data": "Ошибка запуска: " + err.Error()})
			safeWSWriteJSON(&wsMu, ws, map[string]any{"type": "done", "status": "fail"})
			return
		}

		stopMu.Lock()
		stopFn = func() {
			if cmd.Process != nil {
				if runtime.GOOS == "windows" {
					k := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
					k.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
					_ = k.Run()
				} else {
					_ = cmd.Process.Kill()
				}
			}
		}
		stopMu.Unlock()

		var wg sync.WaitGroup
		pump := func(rc io.ReadCloser, kind string) {
			defer wg.Done()
			buf := make([]byte, 2048)
			for {
				n, err := rc.Read(buf)
				if n > 0 {
					safeWSWriteJSON(&wsMu, ws, map[string]any{"type": kind, "data": decodeLocalOutput(buf[:n])})
				}
				if err != nil {
					break
				}
			}
		}
		wg.Add(2)
		go pump(stdout, "out")
		go pump(stderr, "err")
		wg.Wait()

		waitErr := cmd.Wait()
		status := "ok"
		if waitErr != nil {
			status = "fail"
		}
		stopMu.Lock()
		wasStopped := stoppedByUser
		stopMu.Unlock()
		safeWSWriteJSON(&wsMu, ws, map[string]any{"type": "done", "status": status, "stopped": wasStopped})
		return
	}

	client, err := connectSSH(req.Config)
	if err != nil {
		safeWSWriteJSON(&wsMu, ws, map[string]any{"type": "err", "data": "Ошибка SSH: " + err.Error()})
		safeWSWriteJSON(&wsMu, ws, map[string]any{"type": "done", "status": "fail"})
		return
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		safeWSWriteJSON(&wsMu, ws, map[string]any{"type": "err", "data": "Ошибка сессии: " + err.Error()})
		safeWSWriteJSON(&wsMu, ws, map[string]any{"type": "done", "status": "fail"})
		return
	}
	defer session.Close()

	stdout, _ := session.StdoutPipe()
	stderr, _ := session.StderrPipe()

	remoteCmd := cmdStr
	if isPurePython {
		remoteCmd = fmt.Sprintf("python3 - << 'COCKPIT_PY_EOF'\n%s\nCOCKPIT_PY_EOF", cmdStr)
	}
	if cwd != "" {
		remoteCmd = fmt.Sprintf("cd %s && %s", escapePosixSingle(cwd), remoteCmd)
	}

	if err := session.Start(remoteCmd); err != nil {
		safeWSWriteJSON(&wsMu, ws, map[string]any{"type": "err", "data": "Ошибка старта: " + err.Error()})
		safeWSWriteJSON(&wsMu, ws, map[string]any{"type": "done", "status": "fail"})
		return
	}

	stopMu.Lock()
	stopFn = func() {
		_ = session.Signal(ssh.SIGINT)
		_ = session.Close()
	}
	stopMu.Unlock()

	var wg sync.WaitGroup
	pump := func(rc io.Reader, kind string) {
		defer wg.Done()
		buf := make([]byte, 2048)
		for {
			n, err := rc.Read(buf)
			if n > 0 {
				safeWSWriteJSON(&wsMu, ws, map[string]any{"type": kind, "data": string(buf[:n])})
			}
			if err != nil {
				break
			}
		}
	}
	wg.Add(2)
	go pump(stdout, "out")
	go pump(stderr, "err")
	wg.Wait()

	waitErr := session.Wait()
	status := "ok"
	if waitErr != nil {
		status = "fail"
	}
	stopMu.Lock()
	wasStopped := stoppedByUser
	stopMu.Unlock()
	safeWSWriteJSON(&wsMu, ws, map[string]any{"type": "done", "status": status, "stopped": wasStopped})
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	_, initMsg, err := ws.ReadMessage()
	if err != nil {
		return
	}
	var cfg ServerConfig
	_ = json.Unmarshal(initMsg, &cfg)

	if cfg.IsLocal {
		cmd := exec.Command("cmd.exe", "/Q", "/K")
		if strings.TrimSpace(cfg.Cwd) != "" {
			if info, err := os.Stat(strings.TrimSpace(cfg.Cwd)); err == nil && info.IsDir() {
				cmd.Dir = strings.TrimSpace(cfg.Cwd)
			}
		}
		if runtime.GOOS == "windows" {
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		}
		stdin, _ := cmd.StdinPipe()
		stdout, _ := cmd.StdoutPipe()
		cmd.Stderr = cmd.Stdout

		if err := cmd.Start(); err != nil {
			_ = ws.WriteMessage(websocket.TextMessage, []byte("Ошибка запуска CMD: "+err.Error()))
			return
		}
		defer func() {
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
		}()

		go func() {
			buf := make([]byte, 1024)
			for {
				n, err := stdout.Read(buf)
				if n > 0 {
					_ = ws.WriteMessage(websocket.TextMessage, []byte(decodeLocalOutput(buf[:n])))
				}
				if err != nil {
					_ = ws.Close()
					break
				}
			}
		}()

		for {
			_, msg, err := ws.ReadMessage()
			if err != nil {
				break
			}
			if encoded, err := charmap.CodePage866.NewEncoder().Bytes(msg); err == nil {
				_, _ = stdin.Write(encoded)
			} else {
				_, _ = stdin.Write(msg)
			}
		}
		return
	}

	_ = ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n[Подключение к %s...]\r\n", cfg.Host)))
	client, err := connectSSH(&cfg)
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31m[Ошибка SSH: %s]\x1b[0m\r\n", err.Error())))
		time.Sleep(3 * time.Second)
		return
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return
	}
	defer session.Close()

	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
	if err := session.RequestPty("xterm", 35, 100, modes); err != nil {
		return
	}

	sshIn, _ := session.StdinPipe()
	sshOut, _ := session.StdoutPipe()
	session.Stderr = session.Stdout

	if err := session.Shell(); err != nil {
		return
	}
	if strings.TrimSpace(cfg.Cwd) != "" {
		_, _ = sshIn.Write([]byte("cd " + escapePosixSingle(strings.TrimSpace(cfg.Cwd)) + "\n"))
	}

	go func() {
		io.Copy(&wsWriter{ws: ws}, sshOut)
		_ = ws.Close()
	}()

	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			break
		}
		_, _ = sshIn.Write(msg)
	}
}

type wsWriter struct{ ws *websocket.Conn }

func (w *wsWriter) Write(p []byte) (int, error) {
	err := w.ws.WriteMessage(websocket.TextMessage, p)
	return len(p), err
}

func main() {
	if runtime.GOOS == "windows" {
		killCmd := exec.Command("powershell", "-NoProfile", "-Command",
			fmt.Sprintf("Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne %d } | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }", os.Getpid()))
		killCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		_ = killCmd.Run()
	}

	http.HandleFunc("/status", corsMiddleware(handleStatus))
	http.HandleFunc("/shutdown", corsMiddleware(handleShutdown))
	http.HandleFunc("/restart", corsMiddleware(handleRestart))
	http.HandleFunc("/exec", corsMiddleware(handleExec))
	http.HandleFunc("/project/pick-dir", corsMiddleware(handlePickDir))
	http.HandleFunc("/project/bundle", corsMiddleware(handleBundle))
	http.HandleFunc("/git/action", corsMiddleware(handleGitAction))
	http.HandleFunc("/agent/run", corsMiddleware(handleAgentRun))
	http.HandleFunc("/ws/exec", handleWSExec)
	http.HandleFunc("/ws/term", handleWS)

	_ = http.ListenAndServe("127.0.0.1:8765", nil)
}
