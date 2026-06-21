$response = Invoke-WebRequest -Uri 'http://localhost:8090/pipelines/837c6ee1-0ca6-4f5d-ba28-77281af407fa/evaluate' -TimeoutSec 120 -UseBasicParsing
$json = $response.Content | ConvertFrom-Json

Write-Host "Status: $($response.StatusCode)"
Write-Host "task_type: $($json.task_type)"
Write-Host "accuracy (mAP): $($json.accuracy)"
Write-Host "correct_count (AP50): $($json.correct_count)"
Write-Host "incorrect_count (AP75): $($json.incorrect_count)"
Write-Host "lowest_precision_class (Target Objects): $($json.lowest_precision_class)"
Write-Host "lowest_recall_class (Detected Objects): $($json.lowest_recall_class)"
Write-Host "top_confusion: $($json.top_confusion)"
Write-Host "num_samples: $($json.samples.Count)"
Write-Host "num_class_metrics: $($json.class_metrics.Count)"

foreach ($cm in $json.class_metrics) {
    Write-Host "  Class: $($cm.class_name) Count: $($cm.count) Correct: $($cm.correct) Precision: $($cm.precision)"
}

foreach ($s in $json.samples) {
    Write-Host "  Sample: $($s.filename) correct: $($s.correct) true: $($s.true_label) pred: $($s.predicted_label) has_image: $($s.base64_image.Length -gt 0)"
}
