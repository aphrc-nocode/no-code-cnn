with open('c:/Users/Personal/OneDrive/Desktop/no-code/no-code-cnn/shiny_ui_simple.R', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in range(736, 1031):
    line = lines[i]
    if '"' in line:
        print(f"{i+1}: {repr(line)}")
