with open('c:/Users/Personal/OneDrive/Desktop/no-code/no-code-cnn/shiny_ui_simple.R', 'r', encoding='utf-8') as f:
    lines = f.readlines()

keywords = ['upload_dataset', 'upload_job_dropdown', 'dataset_file']
for idx, line in enumerate(lines):
    for keyword in keywords:
        if keyword.lower() in line.lower():
            print(f"{idx+1}: {repr(line.strip())}")
