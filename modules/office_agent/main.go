package main

import (
    "archive/zip"
    "bytes"
    "encoding/base64"
    "encoding/json"
    "encoding/xml"
    "flag"
    "fmt"
    "io"
    "math"
    "os"
    "path/filepath"
    "regexp"
    "strconv"
    "strings"
    "unicode/utf8"

    "github.com/xuri/excelize/v2"
)

type DocBlock struct {
    Type   string  `json:"type"` // heading | text | center | right | table
    Text   string  `json:"text"`
    Bold   bool    `json:"bold"`
    Indent bool    `json:"indent"`
    Rows   [][]any `json:"rows"`
    Border *bool   `json:"border"`
}

func (b *DocBlock) UnmarshalJSON(data []byte) error {
    var s string
    if err := json.Unmarshal(data, &s); err == nil {
        b.Type = "text"
        b.Text = s
        return nil
    }
    type alias DocBlock
    var tmp alias
    if err := json.Unmarshal(data, &tmp); err != nil {
        return err
    }
    *b = DocBlock(tmp)
    if strings.TrimSpace(b.Type) == "" {
        if len(b.Rows) > 0 {
            b.Type = "table"
        } else {
            b.Type = "text"
        }
    }
    return nil
}

type DocSection struct {
    Title      string   `json:"title"`
    Heading    string   `json:"heading"`
    Text       string   `json:"text"`
    Body       string   `json:"body"`
    Content    string   `json:"content"`
    Paragraphs []string `json:"paragraphs"`
}

func (s *DocSection) UnmarshalJSON(data []byte) error {
    var str string
    if err := json.Unmarshal(data, &str); err == nil {
        s.Text = str
        return nil
    }
    type alias DocSection
    var tmp alias
    if err := json.Unmarshal(data, &tmp); err != nil {
        return err
    }
    *s = DocSection(tmp)
    return nil
}

type DocTable struct {
    Rows   [][]any `json:"rows"`
    Border *bool   `json:"border"`
}

type ToolCall struct {
    Tool        string         `json:"tool"`
    Path        string         `json:"path"`
    OutPath     string         `json:"out_path"`
    Sheet       string         `json:"sheet"`
    Range       string         `json:"range"`
    StartRow    int            `json:"start_row"`
    EndRow      int            `json:"end_row"`
    StartCol    string         `json:"start_col"`
    HeaderRow   int            `json:"header_row"`
    AutoStyle   *bool          `json:"auto_style"`
    Merges      []string       `json:"merges"`
    MoneyCols   []string       `json:"money_cols"`
    Cells       map[string]any `json:"cells"`
    Rows        [][]any        `json:"rows"`
    Map         map[string]any `json:"map"`
    Title       string         `json:"title"`
    Subtitle    string         `json:"subtitle"`
    City        string         `json:"city"`
    Date        string         `json:"date"`
    HeaderRight []string       `json:"header_right"`
    Body        string         `json:"body"`
    Content     string         `json:"content"`
    Blocks      []DocBlock     `json:"blocks"`
    Sections    []DocSection   `json:"sections"`
    Paragraphs  []string       `json:"paragraphs"`
    Table       *DocTable      `json:"table"`
    Tables      []DocTable     `json:"tables"`
}

type Payload struct {
    Cwd   string     `json:"cwd"`
    Tools []ToolCall `json:"tools"`
}

func resolveSafePath(cwd, relPath string) (string, error) {
    if strings.TrimSpace(cwd) == "" {
        return "", fmt.Errorf("working directory (cwd) is empty")
    }
    absCwd, err := filepath.Abs(cwd)
    if err != nil {
        return "", err
    }
    p := strings.TrimSpace(relPath)
    if p == "" {
        return "", fmt.Errorf("path is required")
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
        return "", fmt.Errorf("access denied outside cwd: %s", relPath)
    }
    return absTarget, nil
}

// =========================================================
// EXCEL (XLSX_INFO, XLSX_READ, XLSX_WRITE + AutoStyle)
// =========================================================

func xlsxInfo(absPath string) (string, error) {
    f, err := excelize.OpenFile(absPath)
    if err != nil {
        return "", err
    }
    defer f.Close()

    sheets := f.GetSheetList()
    var lines []string
    for _, sh := range sheets {
        rows, err := f.GetRows(sh)
        if err != nil {
            lines = append(lines, fmt.Sprintf("- %s (error: %v)", sh, err))
            continue
        }
        maxCols := 0
        for _, r := range rows {
            if len(r) > maxCols {
                maxCols = len(r)
            }
        }
        lines = append(lines, fmt.Sprintf("- %s: %d rows x %d cols", sh, len(rows), maxCols))
    }
    return "Sheets:\n" + strings.Join(lines, "\n"), nil
}

func parseRangeBounds(rng string) (int, int, int, int, bool) {
    parts := strings.Split(strings.TrimSpace(rng), ":")
    if len(parts) != 2 {
        return 0, 0, 0, 0, false
    }
    c1, r1, err1 := excelize.SplitCellName(strings.TrimSpace(parts[0]))
    c2, r2, err2 := excelize.SplitCellName(strings.TrimSpace(parts[1]))
    if err1 != nil || err2 != nil {
        return 0, 0, 0, 0, false
    }
    cn1, err1 := excelize.ColumnNameToNumber(c1)
    cn2, err2 := excelize.ColumnNameToNumber(c2)
    if err1 != nil || err2 != nil {
        return 0, 0, 0, 0, false
    }
    if cn1 > cn2 {
        cn1, cn2 = cn2, cn1
    }
    if r1 > r2 {
        r1, r2 = r2, r1
    }
    return cn1, r1, cn2, r2, true
}

func xlsxRead(absPath string, call ToolCall) (string, error) {
    f, err := excelize.OpenFile(absPath)
    if err != nil {
        return "", err
    }
    defer f.Close()

    sheet := strings.TrimSpace(call.Sheet)
    if sheet == "" {
        list := f.GetSheetList()
        if len(list) == 0 {
            return "(empty workbook)", nil
        }
        sheet = list[0]
    }

    rows, err := f.GetRows(sheet)
    if err != nil {
        return "", err
    }
    if len(rows) == 0 {
        return fmt.Sprintf("Sheet %q is empty.", sheet), nil
    }

    minCol, maxCol := 1, 0
    startRow := call.StartRow
    endRow := call.EndRow

    if c1, r1, c2, r2, ok := parseRangeBounds(call.Range); ok {
        minCol, startRow, maxCol, endRow = c1, r1, c2, r2
    } else {
        if startRow < 1 {
            startRow = 1
        }
        if endRow < startRow {
            endRow = startRow + 49
        }
    }
    if endRow > len(rows) {
        endRow = len(rows)
    }
    if startRow > len(rows) {
        return fmt.Sprintf("Sheet %q has only %d rows.", sheet, len(rows)), nil
    }

    var sb strings.Builder
    sb.WriteString(fmt.Sprintf("Sheet: %s (rows %d-%d of %d)\n", sheet, startRow, endRow, len(rows)))

    for r := startRow; r <= endRow; r++ {
        rowVals := rows[r-1]
        lastC := len(rowVals)
        if maxCol > 0 && maxCol < lastC {
            lastC = maxCol
        }
        var cellsOut []string
        for c := minCol; c <= lastC; c++ {
            val := strings.TrimSpace(rowVals[c-1])
            cellName, _ := excelize.CoordinatesToCellName(c, r)
            if val == "" {
                if form, _ := f.GetCellFormula(sheet, cellName); form != "" {
                    val = "=" + form
                } else {
                    continue
                }
            }
            cellsOut = append(cellsOut, fmt.Sprintf("%s=%s", cellName, val))
        }
        if len(cellsOut) > 0 {
            sb.WriteString(fmt.Sprintf("R%-3d | %s\n", r, strings.Join(cellsOut, " | ")))
        }
    }
    res := strings.TrimRight(sb.String(), "\n")
    if !strings.Contains(res, "\n") {
        return res + "\n(no non-empty cells in range)", nil
    }
    return res, nil
}

func setTypedCell(f *excelize.File, sheet, cell string, anyVal any) error {
    c := strings.ToUpper(strings.TrimSpace(cell))
    switch v := anyVal.(type) {
    case nil:
        return f.SetCellValue(sheet, c, "")
    case float64:
        return f.SetCellValue(sheet, c, v)
    case bool:
        return f.SetCellValue(sheet, c, v)
    case string:
        if strings.HasPrefix(v, "=") {
            if err := f.SetCellFormula(sheet, c, v[1:]); err != nil {
                return fmt.Errorf("cell %s formula error: %v", c, err)
            }
            return nil
        }
        trimmed := strings.TrimSpace(v)
        isCodeLike := (len(trimmed) > 1 && trimmed[0] == '0' && trimmed[1] != '.') || len(trimmed) >= 10
        if !isCodeLike && trimmed != "" {
            if num, err := strconv.ParseFloat(trimmed, 64); err == nil {
                return f.SetCellValue(sheet, c, num)
            }
        }
        return f.SetCellValue(sheet, c, v)
    default:
        return f.SetCellValue(sheet, c, fmt.Sprint(v))
    }
}

func applySheetAutoStyle(f *excelize.File, sheet string, call ToolCall) {
    rows, err := f.GetRows(sheet)
    if err != nil || len(rows) == 0 {
        return
    }

    mergedHoriz := map[string]bool{}
    if mergedList, err := f.GetMergeCells(sheet); err == nil {
        for _, mc := range mergedList {
            c1, r1, c2, r2, ok := parseRangeBounds(mc.GetStartAxis() + ":" + mc.GetEndAxis())
            if ok && c2 > c1 {
                for rr := r1; rr <= r2; rr++ {
                    for cc := c1; cc <= c2; cc++ {
                        cn, _ := excelize.CoordinatesToCellName(cc, rr)
                        mergedHoriz[cn] = true
                    }
                }
            }
        }
    }

    moneyColSet := map[int]bool{}
    for _, mc := range call.MoneyCols {
        if n, err := excelize.ColumnNameToNumber(strings.ToUpper(strings.TrimSpace(mc))); err == nil {
            moneyColSet[n] = true
        }
    }

    thinBorder := []excelize.Border{
        {Type: "left", Color: "BFBFBF", Style: 1},
        {Type: "right", Color: "BFBFBF", Style: 1},
        {Type: "top", Color: "BFBFBF", Style: 1},
        {Type: "bottom", Color: "BFBFBF", Style: 1},
    }

    stHeader, _ := f.NewStyle(&excelize.Style{
        Font:      &excelize.Font{Bold: true, Size: 11, Family: "Calibri", Color: "1F3864"},
        Fill:      excelize.Fill{Type: "pattern", Color: []string{"D9E1F2"}, Pattern: 1},
        Border:    thinBorder,
        Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true},
    })
    stDataText, _ := f.NewStyle(&excelize.Style{
        Font:      &excelize.Font{Size: 11, Family: "Calibri"},
        Border:    thinBorder,
        Alignment: &excelize.Alignment{Vertical: "center"},
    })
    stDataInt, _ := f.NewStyle(&excelize.Style{
        Font:         &excelize.Font{Size: 11, Family: "Calibri"},
        Border:       thinBorder,
        Alignment:    &excelize.Alignment{Horizontal: "right", Vertical: "center"},
        CustomNumFmt: strPtr("#,##0"),
    })
    stDataMoney, _ := f.NewStyle(&excelize.Style{
        Font:         &excelize.Font{Size: 11, Family: "Calibri"},
        Border:       thinBorder,
        Alignment:    &excelize.Alignment{Horizontal: "right", Vertical: "center"},
        CustomNumFmt: strPtr("#,##0.00"),
    })
    stTotalText, _ := f.NewStyle(&excelize.Style{
        Font:      &excelize.Font{Bold: true, Size: 11, Family: "Calibri"},
        Fill:      excelize.Fill{Type: "pattern", Color: []string{"F2F2F2"}, Pattern: 1},
        Border:    thinBorder,
        Alignment: &excelize.Alignment{Vertical: "center"},
    })
    stTotalMoney, _ := f.NewStyle(&excelize.Style{
        Font:         &excelize.Font{Bold: true, Size: 11, Family: "Calibri"},
        Fill:         excelize.Fill{Type: "pattern", Color: []string{"F2F2F2"}, Pattern: 1},
        Border:       thinBorder,
        Alignment:    &excelize.Alignment{Horizontal: "right", Vertical: "center"},
        CustomNumFmt: strPtr("#,##0.00"),
    })
    stMetaLabel, _ := f.NewStyle(&excelize.Style{
        Font:      &excelize.Font{Bold: true, Size: 11, Family: "Calibri"},
        Alignment: &excelize.Alignment{Vertical: "center"},
    })

    headerRow := call.HeaderRow
    if headerRow <= 0 {
        for rIdx, row := range rows {
            nonEmpty := 0
            for _, v := range row {
                if strings.TrimSpace(v) != "" {
                    nonEmpty++
                }
            }
            if nonEmpty >= 3 {
                headerRow = rIdx + 1
                break
            }
        }
    }

    maxCol := 0
    colWidths := map[int]float64{}

    for rIdx, row := range rows {
        rNum := rIdx + 1
        if len(row) > maxCol {
            maxCol = len(row)
        }

        isTotalRow := false
        for _, v := range row {
            low := strings.ToLower(strings.TrimSpace(v))
            if strings.HasPrefix(low, "итого") || strings.HasPrefix(low, "всего") || strings.HasPrefix(low, "ндс") || strings.HasPrefix(low, "total") {
                isTotalRow = true
                break
            }
        }

        isMetaRow := headerRow > 1 && rNum < headerRow

        for cIdx := 0; cIdx < len(row); cIdx++ {
            cNum := cIdx + 1
            cellName, _ := excelize.CoordinatesToCellName(cNum, rNum)
            val := strings.TrimSpace(row[cIdx])
            formula, _ := f.GetCellFormula(sheet, cellName)
            if val == "" && formula == "" {
                continue
            }

            if !mergedHoriz[cellName] {
                dispLen := utf8.RuneCountInString(val)
                if formula != "" && dispLen < 12 {
                    dispLen = 14
                }
                w := float64(dispLen)*1.18 + 3.5
                if w > colWidths[cNum] {
                    colWidths[cNum] = w
                }
            }

            if rNum == headerRow {
                _ = f.SetCellStyle(sheet, cellName, cellName, stHeader)
                _ = f.SetRowHeight(sheet, rNum, 24)
            } else if isMetaRow {
                if cNum == 1 && strings.HasSuffix(val, ":") {
                    _ = f.SetCellStyle(sheet, cellName, cellName, stMetaLabel)
                }
            } else {
                ct, _ := f.GetCellType(sheet, cellName)
                isNum := ct == excelize.CellTypeNumber || formula != ""
                if isTotalRow {
                    if isNum {
                        _ = f.SetCellStyle(sheet, cellName, cellName, stTotalMoney)
                    } else {
                        _ = f.SetCellStyle(sheet, cellName, cellName, stTotalText)
                    }
                } else {
                    if isNum {
                        numVal, err := strconv.ParseFloat(val, 64)
                        if formula != "" || moneyColSet[cNum] || (err == nil && math.Mod(numVal, 1.0) != 0) {
                            _ = f.SetCellStyle(sheet, cellName, cellName, stDataMoney)
                        } else if err == nil && math.Abs(numVal) >= 1000 {
                            _ = f.SetCellStyle(sheet, cellName, cellName, stDataInt)
                        } else {
                            _ = f.SetCellStyle(sheet, cellName, cellName, stDataText)
                        }
                    } else {
                        _ = f.SetCellStyle(sheet, cellName, cellName, stDataText)
                    }
                }
            }
        }
    }

    for c := 1; c <= maxCol; c++ {
        w := colWidths[c]
        if w < 10 {
            w = 10
        }
        if w > 52 {
            w = 52
        }
        colName, _ := excelize.ColumnNumberToName(c)
        _ = f.SetColWidth(sheet, colName, colName, w)
    }
}

func strPtr(s string) *string { return &s }

func xlsxWrite(absPath string, call ToolCall) (string, error) {
    if len(call.Cells) == 0 && len(call.Rows) == 0 {
        return "", fmt.Errorf("XLSX_WRITE requires 'cells' or 'rows'")
    }

    var f *excelize.File
    isNew := false
    if _, err := os.Stat(absPath); err == nil {
        f, err = excelize.OpenFile(absPath)
        if err != nil {
            return "", err
        }
    } else {
        f = excelize.NewFile()
        isNew = true
    }
    defer f.Close()

    sheet := strings.TrimSpace(call.Sheet)
    if sheet == "" {
        list := f.GetSheetList()
        if len(list) > 0 {
            sheet = list[0]
        } else {
            sheet = "Sheet1"
        }
    }
    if isNew && sheet != "Sheet1" {
        _ = f.SetSheetName("Sheet1", sheet)
    } else if idx, err := f.GetSheetIndex(sheet); err != nil || idx == -1 {
        _, _ = f.NewSheet(sheet)
    }

    written := 0
    if len(call.Rows) > 0 {
        sr := call.StartRow
        if sr < 1 {
            sr = 1
        }
        sc := 1
        if strings.TrimSpace(call.StartCol) != "" {
            if n, err := excelize.ColumnNameToNumber(strings.ToUpper(strings.TrimSpace(call.StartCol))); err == nil && n > 0 {
                sc = n
            }
        }
        for rOff, rowVals := range call.Rows {
            for cOff, val := range rowVals {
                if val == nil {
                    continue
                }
                cn, _ := excelize.CoordinatesToCellName(sc+cOff, sr+rOff)
                if err := setTypedCell(f, sheet, cn, val); err != nil {
                    return "", err
                }
                written++
            }
        }
    }

    for cell, anyVal := range call.Cells {
        if err := setTypedCell(f, sheet, cell, anyVal); err != nil {
            return "", err
        }
        written++
    }

    for _, rng := range call.Merges {
        parts := strings.Split(strings.TrimSpace(rng), ":")
        if len(parts) == 2 {
            _ = f.MergeCell(sheet, strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]))
        }
    }

    shouldStyle := isNew || call.HeaderRow > 0 || len(call.MoneyCols) > 0
    if call.AutoStyle != nil {
        shouldStyle = *call.AutoStyle
    }
    if shouldStyle {
        applySheetAutoStyle(f, sheet, call)
    }

    _ = os.MkdirAll(filepath.Dir(absPath), 0755)
    if isNew {
        if err := f.SaveAs(absPath); err != nil {
            return "", err
        }
    } else {
        if err := f.Save(); err != nil {
            return "", err
        }
    }
    styleTag := ""
    if shouldStyle {
        styleTag = ", auto-styled"
    }
    return fmt.Sprintf("XLSX updated: %s [%s] (%d cells%s)", filepath.Base(absPath), sheet, written, styleTag), nil
}

// =========================================================
// WORD (DOCX_CREATE, DOCX_READ, DOCX_REPLACE)
// =========================================================

func xmlEscape(s string) string {
    var b bytes.Buffer
    _ = xml.EscapeText(&b, []byte(s))
    return b.String()
}

func anyRowsToStrings(rows [][]any) [][]string {
    out := make([][]string, len(rows))
    for i, r := range rows {
        row := make([]string, len(r))
        for j, v := range r {
            if v == nil {
                row[j] = ""
            } else {
                row[j] = fmt.Sprint(v)
            }
        }
        out[i] = row
    }
    return out
}

func makeRunXML(text string, bold bool, sizeHalfPts int) string {
    var pr strings.Builder
    pr.WriteString(`<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>`)
    if bold {
        pr.WriteString(`<w:b/>`)
    }
    if sizeHalfPts > 0 {
        pr.WriteString(fmt.Sprintf(`<w:sz w:val="%d"/><w:szCs w:val="%d"/>`, sizeHalfPts, sizeHalfPts))
    }
    pr.WriteString(`</w:rPr>`)
    return `<w:r>` + pr.String() + `<w:t xml:space="preserve">` + xmlEscape(text) + `</w:t></w:r>`
}

func makeParaXML(text string, align string, bold bool, sizeHalfPts int, spaceBefore, spaceAfter, indentLeft, firstLine int) string {
    var ppr strings.Builder
    ppr.WriteString(`<w:pPr>`)
    if align != "" {
        ppr.WriteString(fmt.Sprintf(`<w:jc w:val="%s"/>`, align))
    }
    ppr.WriteString(fmt.Sprintf(`<w:spacing w:before="%d" w:after="%d" w:line="276" w:lineRule="auto"/>`, spaceBefore, spaceAfter))
    if indentLeft > 0 || firstLine > 0 {
        ppr.WriteString(`<w:ind`)
        if indentLeft > 0 {
            ppr.WriteString(fmt.Sprintf(` w:left="%d"`, indentLeft))
        }
        if firstLine > 0 {
            ppr.WriteString(fmt.Sprintf(` w:firstLine="%d"`, firstLine))
        }
        ppr.WriteString(`/>`)
    }
    ppr.WriteString(`</w:pPr>`)
    if text == "" {
        return `<w:p>` + ppr.String() + `</w:p>`
    }
    return `<w:p>` + ppr.String() + makeRunXML(text, bold, sizeHalfPts) + `</w:p>`
}

func makeCityDateXML(city, date string) string {
    const totalW = 9355
    halfW := totalW / 2
    var sb strings.Builder
    sb.WriteString(`<w:tbl><w:tblPr>`)
    sb.WriteString(fmt.Sprintf(`<w:tblW w:w="%d" w:type="dxa"/>`, totalW))
    sb.WriteString(`<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>`)
    sb.WriteString(`</w:tblPr><w:tblGrid>`)
    sb.WriteString(fmt.Sprintf(`<w:gridCol w:w="%d"/><w:gridCol w:w="%d"/>`, halfW, totalW-halfW))
    sb.WriteString(`</w:tblGrid><w:tr>`)
    sb.WriteString(fmt.Sprintf(`<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>`, halfW))
    sb.WriteString(makeParaXML(city, "left", false, 24, 0, 80, 0, 0))
    sb.WriteString(`</w:tc>`)
    sb.WriteString(fmt.Sprintf(`<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>`, totalW-halfW))
    sb.WriteString(makeParaXML(date, "right", false, 24, 0, 80, 0, 0))
    sb.WriteString(`</w:tc></w:tr></w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr></w:p>`)
    return sb.String()
}

func makeTableXML(rows [][]string, withBorder bool) string {
    if len(rows) == 0 {
        return ""
    }
    maxCols := 0
    for _, r := range rows {
        if len(r) > maxCols {
            maxCols = len(r)
        }
    }
    if maxCols == 0 {
        return ""
    }
    const totalW = 9355
    colW := totalW / maxCols

    borderXML := `<w:tblBorders>
        <w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/>
        <w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/>
    </w:tblBorders>`
    if withBorder {
        borderXML = `<w:tblBorders>
            <w:top w:val="single" w:sz="4" w:space="0" w:color="666666"/>
            <w:left w:val="single" w:sz="4" w:space="0" w:color="666666"/>
            <w:bottom w:val="single" w:sz="4" w:space="0" w:color="666666"/>
            <w:right w:val="single" w:sz="4" w:space="0" w:color="666666"/>
            <w:insideH w:val="single" w:sz="4" w:space="0" w:color="888888"/>
            <w:insideV w:val="single" w:sz="4" w:space="0" w:color="888888"/>
        </w:tblBorders>`
    }

    var sb strings.Builder
    sb.WriteString(`<w:tbl><w:tblPr>`)
    sb.WriteString(fmt.Sprintf(`<w:tblW w:w="%d" w:type="dxa"/>`, totalW))
    sb.WriteString(borderXML)
    sb.WriteString(`<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>`)
    sb.WriteString(`</w:tblPr><w:tblGrid>`)
    for i := 0; i < maxCols; i++ {
        sb.WriteString(fmt.Sprintf(`<w:gridCol w:w="%d"/>`, colW))
    }
    sb.WriteString(`</w:tblGrid>`)

    for rIdx, row := range rows {
        sb.WriteString(`<w:tr>`)
        isHeader := withBorder && rIdx == 0
        for cIdx := 0; cIdx < maxCols; cIdx++ {
            cellText := ""
            if cIdx < len(row) {
                cellText = row[cIdx]
            }
            sb.WriteString(fmt.Sprintf(`<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>`, colW))
            if isHeader {
                sb.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="EAEFF7"/>`)
            }
            sb.WriteString(`</w:tcPr>`)
            align := "left"
            if isHeader {
                align = "center"
            }
            // Каждую строку внутри ячейки оформляем отдельным <w:p>, чтобы DOCX_REPLACE сохранял переносы!
            cellLines := strings.Split(strings.ReplaceAll(cellText, "\r\n", "\n"), "\n")
            for lIdx, ln := range cellLines {
                lineBold := isHeader || (!withBorder && lIdx == 0 && strings.HasSuffix(strings.TrimSpace(ln), ":") && strings.ToUpper(ln) == ln)
                sb.WriteString(makeParaXML(ln, align, lineBold, 22, 0, 40, 0, 0))
            }
            sb.WriteString(`</w:tc>`)
        }
        sb.WriteString(`</w:tr>`)
    }
    sb.WriteString(`</w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="80"/></w:pPr></w:p>`)
    return sb.String()
}

var reSubPoint = regexp.MustCompile(`^\d+\.\d+`)

func writeMultilineSection(body *strings.Builder, raw string, hasExplicitHeading bool) int {
    lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
    count := 0
    for i, ln := range lines {
        t := strings.TrimSpace(ln)
        if t == "" {
            continue
        }
        isHeading := !hasExplicitHeading && i == 0 && !reSubPoint.MatchString(t) && (strings.ToUpper(t) == t || len(lines) == 1)
        if isHeading {
            body.WriteString(makeParaXML(t, "left", true, 24, 180, 80, 0, 0))
        } else {
            firstLine := 709
            if strings.HasPrefix(t, "•") || strings.HasPrefix(t, "-") {
                firstLine = 0
            }
            body.WriteString(makeParaXML(t, "both", false, 24, 0, 90, 0, firstLine))
        }
        count++
    }
    return count
}

func docxCreate(absPath string, call ToolCall) (string, error) {
    var body strings.Builder
    elemCount := 0

    // 1. Правая шапка (для заявлений / служебных записок)
    for i, line := range call.HeaderRight {
        after := 40
        if i == len(call.HeaderRight)-1 {
            after = 260
        }
        body.WriteString(makeParaXML(line, "left", false, 24, 0, after, 4500, 0))
        elemCount++
    }

    // 2. Заголовок и подзаголовок
    if strings.TrimSpace(call.Title) != "" {
        after := 140
        if strings.TrimSpace(call.Subtitle) != "" || strings.TrimSpace(call.City) != "" || strings.TrimSpace(call.Date) != "" {
            after = 60
        }
        body.WriteString(makeParaXML(call.Title, "center", true, 26, 120, after, 0, 0))
        elemCount++
    }
    if strings.TrimSpace(call.Subtitle) != "" {
        body.WriteString(makeParaXML(call.Subtitle, "center", false, 24, 0, 140, 0, 0))
        elemCount++
    }

    // 3. Строка город + дата (типовая для российских договоров)
    if strings.TrimSpace(call.City) != "" || strings.TrimSpace(call.Date) != "" {
        body.WriteString(makeCityDateXML(call.City, call.Date))
        elemCount++
    }

    // 4. Plain body / content
    if strings.TrimSpace(call.Body) != "" {
        elemCount += writeMultilineSection(&body, call.Body, true)
    }
    if strings.TrimSpace(call.Content) != "" {
        elemCount += writeMultilineSection(&body, call.Content, true)
    }

    // 5. Простые абзацы
    for _, p := range call.Paragraphs {
        elemCount += writeMultilineSection(&body, p, true)
    }

    // 6. Разделы (sections: строки или объекты {title/heading, text/body/content, paragraphs})
    for _, sec := range call.Sections {
        h := strings.TrimSpace(sec.Title)
        if h == "" {
            h = strings.TrimSpace(sec.Heading)
        }
        if h != "" {
            body.WriteString(makeParaXML(h, "left", true, 24, 180, 80, 0, 0))
            elemCount++
        }
        txt := sec.Text
        if strings.TrimSpace(txt) == "" {
            txt = sec.Body
        }
        if strings.TrimSpace(txt) == "" {
            txt = sec.Content
        }
        if strings.TrimSpace(txt) != "" {
            elemCount += writeMultilineSection(&body, txt, h != "")
        }
        for _, p := range sec.Paragraphs {
            elemCount += writeMultilineSection(&body, p, true)
        }
    }

    // 7. Структурированные блоки (blocks)
    for _, b := range call.Blocks {
        switch strings.ToLower(strings.TrimSpace(b.Type)) {
        case "heading", "h1", "h2":
            body.WriteString(makeParaXML(b.Text, "left", true, 24, 180, 80, 0, 0))
            elemCount++
        case "center":
            body.WriteString(makeParaXML(b.Text, "center", b.Bold, 24, 60, 100, 0, 0))
            elemCount++
        case "right":
            body.WriteString(makeParaXML(b.Text, "right", b.Bold, 24, 60, 100, 0, 0))
            elemCount++
        case "table":
            withBorder := true
            if b.Border != nil {
                withBorder = *b.Border
            }
            body.WriteString(makeTableXML(anyRowsToStrings(b.Rows), withBorder))
            elemCount++
        default:
            lines := strings.Split(strings.ReplaceAll(b.Text, "\r\n", "\n"), "\n")
            for _, ln := range lines {
                if strings.TrimSpace(ln) == "" {
                    continue
                }
                firstLine := 709
                if !b.Indent && (strings.HasPrefix(strings.TrimSpace(ln), "•") || strings.HasPrefix(strings.TrimSpace(ln), "-")) {
                    firstLine = 0
                }
                body.WriteString(makeParaXML(ln, "both", b.Bold, 24, 0, 90, 0, firstLine))
                elemCount++
            }
        }
    }

    // 8. Таблица/таблицы на верхнем уровне (table / tables)
    if call.Table != nil && len(call.Table.Rows) > 0 {
        withBorder := true
        if call.Table.Border != nil {
            withBorder = *call.Table.Border
        }
        body.WriteString(makeTableXML(anyRowsToStrings(call.Table.Rows), withBorder))
        elemCount++
    }
    for _, tbl := range call.Tables {
        if len(tbl.Rows) == 0 {
            continue
        }
        withBorder := true
        if tbl.Border != nil {
            withBorder = *tbl.Border
        }
        body.WriteString(makeTableXML(anyRowsToStrings(tbl.Rows), withBorder))
        elemCount++
    }

    if elemCount == 0 {
        return "", fmt.Errorf("DOCX_CREATE received no content (use title, city/date, blocks, sections, paragraphs or table)")
    }

    docXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        body.String() +
        `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>` +
        `</w:body></w:document>`

    contentTypes := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

    rootRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

    docRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

    stylesXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
      <w:sz w:val="24"/><w:szCs w:val="24"/>
      <w:lang w:val="ru-RU"/>
    </w:rPr></w:rPrDefault>
  </w:docDefaults>
</w:styles>`

    files := map[string]string{
        "[Content_Types].xml":          contentTypes,
        "_rels/.rels":                  rootRels,
        "word/_rels/document.xml.rels": docRels,
        "word/styles.xml":              stylesXML,
        "word/document.xml":            docXML,
    }

    var buf bytes.Buffer
    zw := zip.NewWriter(&buf)
    for name, content := range files {
        w, err := zw.Create(name)
        if err != nil {
            return "", err
        }
        if _, err := w.Write([]byte(content)); err != nil {
            return "", err
        }
    }
    if err := zw.Close(); err != nil {
        return "", err
    }

    _ = os.MkdirAll(filepath.Dir(absPath), 0755)
    if err := os.WriteFile(absPath, buf.Bytes(), 0644); err != nil {
        return "", err
    }
    return fmt.Sprintf("DOCX created: %s (%d elements)", filepath.Base(absPath), elemCount), nil
}

func docxRead(absPath string, call ToolCall) (string, error) {
    r, err := zip.OpenReader(absPath)
    if err != nil {
        return "", err
    }
    defer r.Close()

    var docData []byte
    for _, f := range r.File {
        if f.Name == "word/document.xml" {
            rc, err := f.Open()
            if err != nil {
                return "", err
            }
            docData, err = io.ReadAll(rc)
            rc.Close()
            if err != nil {
                return "", err
            }
            break
        }
    }
    if len(docData) == 0 {
        return "", fmt.Errorf("word/document.xml not found in %s", filepath.Base(absPath))
    }

    dec := xml.NewDecoder(bytes.NewReader(docData))
    var paras []string
    var curPara strings.Builder
    inPara := false
    inText := false
    inTable := false

    for {
        tok, err := dec.Token()
        if err == io.EOF {
            break
        }
        if err != nil {
            return "", err
        }
        switch el := tok.(type) {
        case xml.StartElement:
            switch el.Name.Local {
            case "tbl":
                inTable = true
            case "p":
                inPara = true
                curPara.Reset()
            case "t":
                inText = true
            case "tab":
                if inPara {
                    curPara.WriteString("\t")
                }
            case "br":
                if inPara {
                    curPara.WriteString("\n")
                }
            }
        case xml.EndElement:
            switch el.Name.Local {
            case "tbl":
                inTable = false
            case "t":
                inText = false
            case "p":
                if inPara {
                    txt := strings.TrimSpace(curPara.String())
                    if txt != "" {
                        if inTable {
                            txt = "[TBL] " + txt
                        }
                        paras = append(paras, txt)
                    }
                    inPara = false
                }
            }
        case xml.CharData:
            if inPara && inText {
                curPara.Write(el)
            }
        }
    }

    if len(paras) == 0 {
        return "(empty document)", nil
    }
    start := call.StartRow
    if start < 1 {
        start = 1
    }
    end := call.EndRow
    if end < start {
        end = start + 79
    }
    if end > len(paras) {
        end = len(paras)
    }
    if start > len(paras) {
        return fmt.Sprintf("Document has only %d paragraphs.", len(paras)), nil
    }

    var sb strings.Builder
    sb.WriteString(fmt.Sprintf("DOCX: %s (paragraphs %d-%d of %d)\n", filepath.Base(absPath), start, end, len(paras)))
    for i := start; i <= end; i++ {
        sb.WriteString(fmt.Sprintf("P%-3d | %s\n", i, paras[i-1]))
    }
    return strings.TrimRight(sb.String(), "\n"), nil
}

var (
    rePara = regexp.MustCompile(`(?s)<w:p\b[^>]*>.*?</w:p>`)
    reText = regexp.MustCompile(`(?s)(<w:t(?:\s[^>]*)?>)([^<]*)(</w:t>)`)
)

func replaceInDocxXML(xmlStr string, repl map[string]string) (string, int) {
    totalReplaced := 0
    out := rePara.ReplaceAllStringFunc(xmlStr, func(para string) string {
        matches := reText.FindAllStringSubmatchIndex(para, -1)
        if len(matches) == 0 {
            return para
        }
        type span struct {
            openTag  string
            text     string
            closeTag string
            fullS    int
            fullE    int
        }
        spans := make([]span, len(matches))
        var joined strings.Builder
        for i, m := range matches {
            spans[i] = span{
                openTag:  para[m[2]:m[3]],
                text:     para[m[4]:m[5]],
                closeTag: para[m[6]:m[7]],
                fullS:    m[0],
                fullE:    m[1],
            }
            joined.WriteString(spans[i].text)
        }
        combined := joined.String()
        updated := combined
        replacedInPara := 0
        for k, v := range repl {
            if k != "" && strings.Contains(updated, k) {
                cnt := strings.Count(updated, k)
                updated = strings.ReplaceAll(updated, k, xmlEscape(v))
                replacedInPara += cnt
            }
        }
        if replacedInPara == 0 {
            return para
        }
        totalReplaced += replacedInPara

        var res strings.Builder
        cursor := 0
        for i, sp := range spans {
            res.WriteString(para[cursor:sp.fullS])
            if i == 0 {
                open := sp.openTag
                if !strings.Contains(open, "xml:space") {
                    open = strings.TrimSuffix(open, ">") + ` xml:space="preserve">`
                }
                res.WriteString(open + updated + sp.closeTag)
            } else {
                res.WriteString(sp.openTag + sp.closeTag)
            }
            cursor = sp.fullE
        }
        res.WriteString(para[cursor:])
        return res.String()
    })
    return out, totalReplaced
}

func docxReplace(absIn, absOut string, rawRepl map[string]any) (string, error) {
    repl := make(map[string]string, len(rawRepl))
    for k, v := range rawRepl {
        if v == nil {
            repl[k] = ""
        } else {
            repl[k] = fmt.Sprint(v)
        }
    }
    if len(repl) == 0 {
        return "", fmt.Errorf("DOCX_REPLACE requires 'map'")
    }
    r, err := zip.OpenReader(absIn)
    if err != nil {
        return "", err
    }
    defer r.Close()

    var buf bytes.Buffer
    zw := zip.NewWriter(&buf)
    totalCount := 0

    for _, f := range r.File {
        rc, err := f.Open()
        if err != nil {
            return "", err
        }
        data, err := io.ReadAll(rc)
        rc.Close()
        if err != nil {
            return "", err
        }

        if f.Name == "word/document.xml" || strings.HasPrefix(f.Name, "word/header") || strings.HasPrefix(f.Name, "word/footer") {
            replacedXML, cnt := replaceInDocxXML(string(data), repl)
            totalCount += cnt
            data = []byte(replacedXML)
        }

        hdr := &zip.FileHeader{
            Name:   f.Name,
            Method: zip.Deflate,
        }
        w, err := zw.CreateHeader(hdr)
        if err != nil {
            return "", err
        }
        if _, err := w.Write(data); err != nil {
            return "", err
        }
    }
    if err := zw.Close(); err != nil {
        return "", err
    }

    _ = os.MkdirAll(filepath.Dir(absOut), 0755)
    if err := os.WriteFile(absOut, buf.Bytes(), 0644); err != nil {
        return "", err
    }
    return fmt.Sprintf("DOCX saved: %s (%d replacements)", filepath.Base(absOut), totalCount), nil
}

func main() {
    payloadB64 := flag.String("payload", "", "base64 json payload")
    flag.Parse()

    if *payloadB64 == "" {
        fmt.Fprintln(os.Stderr, "missing -payload")
        os.Exit(1)
    }
    raw, err := base64.StdEncoding.DecodeString(*payloadB64)
    if err != nil {
        fmt.Fprintf(os.Stderr, "base64 error: %v\n", err)
        os.Exit(1)
    }
    var p Payload
    if err := json.Unmarshal(raw, &p); err != nil {
        fmt.Fprintf(os.Stderr, "json error: %v\n", err)
        os.Exit(1)
    }

    var outputs []string
    for i, call := range p.Tools {
        tool := strings.ToUpper(strings.TrimSpace(call.Tool))
        absPath, err := resolveSafePath(p.Cwd, call.Path)
        if err != nil {
            fmt.Printf("### [%d] %s %s\nERROR: %v\n", i+1, tool, call.Path, err)
            os.Exit(1)
        }

        var out string
        switch tool {
        case "XLSX_INFO":
            out, err = xlsxInfo(absPath)
        case "XLSX_READ":
            out, err = xlsxRead(absPath, call)
        case "XLSX_WRITE":
            out, err = xlsxWrite(absPath, call)
        case "DOCX_CREATE":
            out, err = docxCreate(absPath, call)
        case "DOCX_READ":
            out, err = docxRead(absPath, call)
        case "DOCX_REPLACE":
            absOut := absPath
            if strings.TrimSpace(call.OutPath) != "" {
                absOut, err = resolveSafePath(p.Cwd, call.OutPath)
            }
            if err == nil {
                out, err = docxReplace(absPath, absOut, call.Map)
            }
        default:
            err = fmt.Errorf("unknown office tool: %s", tool)
        }

        header := fmt.Sprintf("### [%d] %s %s", i+1, tool, call.Path)
        if err != nil {
            fmt.Printf("%s\nERROR: %v\n", header, err)
            os.Exit(1)
        }
        outputs = append(outputs, header+"\n"+out)
    }

    fmt.Println(strings.Join(outputs, "\n\n"))
}