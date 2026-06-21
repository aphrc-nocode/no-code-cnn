with open('c:/Users/Personal/OneDrive/Desktop/no-code/no-code-cnn/shiny_ui_simple.R', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace "Segoe UI" with 'Segoe UI' inside the CSS block
updated_content = content.replace('"Segoe UI"', "'Segoe UI'")

with open('c:/Users/Personal/OneDrive/Desktop/no-code/no-code-cnn/shiny_ui_simple.R', 'w', encoding='utf-8') as f:
    f.write(updated_content)

print("Replacement complete.")
