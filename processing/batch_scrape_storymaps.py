import json
import os
import time
from playwright.sync_api import sync_playwright

DATA_FILE = 'processing/student_data_both_parts_verified.json'
OUTPUT_DIR = 'processing/storymaps_archive'

def scrape_storymaps():
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        
        for student_record in data:
            student_name = student_record.get('student')
            if not student_name:
                continue
                
            print(f"Processing {student_name}...")
            student_dir = os.path.join(OUTPUT_DIR, student_name)
            os.makedirs(student_dir, exist_ok=True)
            
            urls_to_process = []
            
            # 1. Primary URL
            url1 = student_record.get('storymap_url')
            if url1:
                urls_to_process.append(('part1', url1))
            
            # 2. Secondary URL (if mismatch)
            if student_record.get('url_mismatch'):
                url2 = student_record.get('storymap_url_2')
                if url2:
                    urls_to_process.append(('part2', url2))
            
            for label, url in urls_to_process:
                output_path = os.path.join(student_dir, f"{label}.png")
                
                if os.path.exists(output_path):
                    print(f"  - Skipping {label} (already exists)")
                    continue
                    
                print(f"  - Downloading {label}: {url}")
                
                try:
                    page = context.new_page()
                    page.goto(url, wait_until='networkidle', timeout=60000)
                    
                    # Give it a little extra time for animations/maps
                    time.sleep(5)
                    
                    # Remove some common cookie banners if possible (optional heuristic)
                    try:
                        page.evaluate("() => { const banners = document.querySelectorAll('.cookie-banner, #onetrust-banner-sdk'); banners.forEach(b => b.remove()); }")
                    except:
                        pass
                        
                    page.screenshot(path=output_path, full_page=True)
                    print(f"    -> Saved to {output_path}")
                    
                    page.close()
                    
                except Exception as e:
                    print(f"    -> FAILED {label}: {e}")

        browser.close()

if __name__ == "__main__":
    scrape_storymaps()


