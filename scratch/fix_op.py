with open('c:/Users/Personal/OneDrive/Desktop/no-code/no-code-cnn/shiny_ui_simple.R', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Remove lines with %%||%%
new_lines = [line for line in lines if '%%||%%' not in line]

with open('c:/Users/Personal/OneDrive/Desktop/no-code/no-code-cnn/shiny_ui_simple.R', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Removed operator syntax error.")
