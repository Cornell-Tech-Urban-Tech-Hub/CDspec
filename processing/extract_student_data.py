import os
import csv
import json
import sys
import re
try:
    import pandas as pd
except ImportError:
    pd = None

SOURCE_DIR_1 = 'lecture_checklists/cdspec_1'
SOURCE_DIR_2 = 'lecture_checklists/cdspec_2'
OUTPUT_FILE = 'processing/student_data.json'
LOG_FILE = 'processing/extraction_errors.log'

def log_error(message):
    print(message)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(message + '\n')

def extract_from_rows(rows):
    """
    Attempts to find "Community District" and "StoryMap URL" in a list of lists (rows).
    Returns (cd, url, found_issues_bool)
    """
    cd = None
    url = None
    issues = False

    # Scan first 10 rows to find keys
    for row in rows[:10]:
        if not row:
            continue
        # Convert all cells to string for safe checking
        row_str = [str(cell).strip() for cell in row]
        
        # Look for Community District
        if not cd:
            for i, cell in enumerate(row_str):
                if "community district" in cell.lower():
                    # If value is in the next cell
                    if i + 1 < len(row_str) and row_str[i+1]:
                        cd = row_str[i+1]
                    # Or if the value is in the same cell after a colon
                    elif ":" in cell:
                        parts = cell.split(":", 1)
                        if len(parts) > 1 and parts[1].strip():
                            cd = parts[1].strip()
                    break
        
        # Look for StoryMap URL
        if not url:
            for i, cell in enumerate(row_str):
                if "storymap url" in cell.lower():
                    if i + 1 < len(row_str) and row_str[i+1]:
                        url = row_str[i+1]
                    elif ":" in cell:
                        parts = cell.split(":", 1)
                        if len(parts) > 1 and parts[1].strip():
                            url = parts[1].strip()
                    break
    
    if not cd or not url:
        issues = True
        
    return cd, url, issues

def extract_url_from_html(filepath):
    """
    Extracts the redirection URL from an HTML file.
    Checks for <a href="..."> and <meta ... url=...>
    """
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            
            # Strategy 1: Check for anchor tag
            # <a href="https://arcg.is/15KnDO0">
            match = re.search(r'<a\s+[^>]*href=["\']([^"\']+)["\']', content, re.IGNORECASE)
            if match:
                return match.group(1)
            
            # Strategy 2: Check for meta refresh
            # <meta http-equiv="Refresh" content="0; url=https://arcg.is/15KnDO0">
            match = re.search(r'content=["\'][^"\']*url=([^"\';]+)', content, re.IGNORECASE)
            if match:
                return match.group(1)
                
    except Exception as e:
        log_error(f"HTML FAIL: {filepath} - {e}")
        
    return None

def process_files():
    records = {}
    
    # Clear previous log
    if os.path.exists(LOG_FILE):
        os.remove(LOG_FILE)

    # --- PART 1: Process CSV/Excel Files ---
    if not os.path.exists(SOURCE_DIR_1):
        log_error(f"CRITICAL: Directory not found: {SOURCE_DIR_1}")
    else:
        files = os.listdir(SOURCE_DIR_1)
        files.sort()

        for filename in files:
            filepath = os.path.join(SOURCE_DIR_1, filename)
            
            if filename.startswith('.'):
                continue
                
            student_name = filename.split('_')[0]
            needs_review = False
            community_district = None
            storymap_url = None
            
            # Strategy 1: Try reading as standard CSV
            try:
                # Check for binary/excel signature
                is_binary = False
                try:
                    with open(filepath, 'rb') as f:
                        header = f.read(4)
                        if header.startswith(b'PK'):
                            is_binary = True
                except:
                    pass

                if is_binary:
                     raise ValueError("Detected Excel file signature")

                with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                    reader = csv.reader(f)
                    rows = list(reader)
                    
                    # Strict check
                    strict_ok = True
                    if len(rows) < 2:
                        strict_ok = False
                    else:
                        if "Community District" not in str(rows[0][0]): strict_ok = False
                        if "StoryMap URL" not in str(rows[1][0]): strict_ok = False
                    
                    if not strict_ok:
                        log_error(f"DEVIANT FORMAT: {filename} - trying fuzzy search.")
                        needs_review = True
                    
                    community_district, storymap_url, issues = extract_from_rows(rows)
                    if issues:
                        needs_review = True

            except Exception as e_csv:
                # Strategy 2: Try reading with Pandas
                log_error(f"CSV FAIL: {filename} ({e_csv}). Attempting with Pandas...")
                needs_review = True
                
                try:
                    if pd is None:
                        raise ImportError("Pandas library not available for advanced parsing.")

                    if str(e_csv) == "Detected Excel file signature" or filename.endswith('.xlsx') or filename.endswith('.xls'):
                        df = pd.read_excel(filepath, header=None)
                    else:
                        df = pd.read_csv(filepath, header=None, on_bad_lines='skip', encoding_errors='replace')
                    
                    rows = df.values.tolist()
                    community_district, storymap_url, issues = extract_from_rows(rows)
                    
                    if issues:
                        log_error(f"PANDAS FAIL: {filename} - Still missing data after coercion.")
                    else:
                        log_error(f"RECOVERED: {filename} - Extracted data using Pandas/Fuzzy search.")

                except Exception as e_pd:
                    log_error(f"FATAL: Could not process {filename}. Error: {e_pd}")
                    needs_review = True

            # Final check for Part 1
            if not community_district:
                log_error(f"MISSING DATA: {filename} - No Community District found.")
                needs_review = True
            if not storymap_url:
                log_error(f"MISSING DATA: {filename} - No StoryMap URL found.")
                needs_review = True

            records[student_name] = {
                "student": student_name,
                "community_district": community_district,
                "storymap_url": storymap_url, # Primary URL (usually from Part 1)
                "needs_review": needs_review,
                "part_1_completed": True
            }

    # --- PART 2: Process HTML Files ---
    if os.path.exists(SOURCE_DIR_2):
        files2 = os.listdir(SOURCE_DIR_2)
        files2.sort()
        
        for filename in files2:
            filepath = os.path.join(SOURCE_DIR_2, filename)
            
            if filename.startswith('.') or not filename.endswith('.html'):
                continue
                
            student_name = filename.split('_')[0]
            url_2 = extract_url_from_html(filepath)
            
            if not url_2:
                log_error(f"PART 2 FAIL: Could not extract URL from {filename}")
                # If record exists, flag it
                if student_name in records:
                    records[student_name]["needs_review"] = True
                    records[student_name]["part_2_error"] = "No URL found in HTML"
                continue

            if student_name in records:
                # Student exists from Part 1
                records[student_name]["storymap_url_2"] = url_2
                records[student_name]["part_2_completed"] = True
                
                url_1 = records[student_name].get("storymap_url")
                
                # Compare URLs
                u1_clean = url_1.strip().rstrip('/').lower() if url_1 else ""
                u2_clean = url_2.strip().rstrip('/').lower() if url_2 else ""
                
                # If Part 1 URL missing, take Part 2
                if not u1_clean and u2_clean:
                    records[student_name]["storymap_url"] = url_2
                    log_error(f"UPDATED: {student_name} - Using Part 2 URL (Part 1 missing).")
                    
                elif u1_clean and u2_clean and u1_clean != u2_clean:
                    records[student_name]["url_mismatch"] = True
                    # We keep Part 1 as primary, but flag mismatch
                    log_error(f"URL MISMATCH: {student_name} - Part 1: {url_1} vs Part 2: {url_2}")
                
            else:
                # New student only in Part 2
                records[student_name] = {
                    "student": student_name,
                    "community_district": None,
                    "storymap_url": url_2,
                    "storymap_url_2": url_2,
                    "needs_review": True,
                    "part_1_completed": False,
                    "part_2_completed": True,
                    "note": "Found only in Part 2"
                }
                log_error(f"NEW STUDENT: {student_name} found in Part 2.")

    # Ensure output directory exists
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    
    data = list(records.values())
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    
    print(f"Processed {len(data)} student records. Output saved to {OUTPUT_FILE}")
    print(f"Errors and warnings logged to {LOG_FILE}")

if __name__ == "__main__":
    process_files()
