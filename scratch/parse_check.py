import subprocess

try:
    result = subprocess.run(
        ["Rscript", "-e", "parse('c:/Users/Personal/OneDrive/Desktop/no-code/no-code-cnn/shiny_ui_simple.R')"],
        capture_output=True,
        text=True
    )
    print("STDOUT:")
    print(result.stdout)
    print("STDERR:")
    print(result.stderr)
except Exception as e:
    print("Exception running Rscript:", e)
