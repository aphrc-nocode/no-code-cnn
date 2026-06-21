with open('c:/Users/Personal/OneDrive/Desktop/no-code/no-code-cnn/shiny_ui_simple.R', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if '%%||%%' in line:
        print(f"{idx+1}: {repr(line)}")
