"""
Bias Information Resource Library
Provides comprehensive information about bias types, examples, and mitigation strategies
"""

from typing import Dict, List, Any
import json


class BiasResourceLibrary:
    """Library of bias information and resources for the no-code platform"""
    
    def __init__(self):
        self.bias_types = self._initialize_bias_types()
        self.bias_examples = self._initialize_bias_examples()
        self.mitigation_strategies = self._initialize_mitigation_strategies()
        self.checklist = self._initialize_checklist()
    
    def _initialize_bias_types(self) -> Dict[str, Dict[str, str]]:
        """Initialize comprehensive bias type definitions"""
        return {
            "selection_bias": {
                "name": "Selection Bias",
                "description": "Occurs when the data collection process is not representative of the population",
                "causes": [
                    "Non-random sampling methods",
                    "Convenience sampling",
                    "Self-selection bias in surveys",
                    "Survivorship bias"
                ],
                "impact": "Model learns from unrepresentative data, leading to poor generalization",
                "detection_methods": [
                    "Compare dataset demographics to target population",
                    "Analyze sampling methodology",
                    "Check for missing data patterns"
                ]
            },
            "label_bias": {
                "name": "Label Bias",
                "description": "Occurs when labels are assigned inconsistently or reflect human biases",
                "causes": [
                    "Subjective labeling by humans",
                    "Cultural or societal biases in labeling",
                    "Inconsistent annotation guidelines",
                    "Annotator fatigue or bias"
                ],
                "impact": "Model learns and amplifies human biases present in labels",
                "detection_methods": [
                    "Inter-annotator agreement analysis",
                    "Review annotation guidelines",
                    "Audit label distribution across subgroups"
                ]
            },
            "measurement_bias": {
                "name": "Measurement Bias",
                "description": "Occurs when features or measurements are systematically different across groups",
                "causes": [
                    "Different measurement tools for different groups",
                    "Sensor calibration issues",
                    "Feature extraction methods that favor certain groups",
                    "Proxy variables that correlate with sensitive attributes"
                ],
                "impact": "Model performs differently for groups with different measurement characteristics",
                "detection_methods": [
                    "Compare feature distributions across groups",
                    "Analyze measurement processes",
                    "Check for proxy variables"
                ]
            },
            "historical_bias": {
                "name": "Historical Bias",
                "description": "Occurs when training data reflects historical prejudices and societal inequalities",
                "causes": [
                    "Historical discrimination in data sources",
                    "Stereotypical representations in historical data",
                    "Legacy systems with biased decisions",
                    "Cultural and societal norms embedded in data"
                ],
                "impact": "Model perpetuates and amplifies existing societal biases",
                "detection_methods": [
                    "Historical analysis of data sources",
                    "Compare model predictions across demographic groups",
                    "Review data collection timeline and context"
                ]
            },
            "representation_bias": {
                "name": "Representation Bias",
                "description": "Occurs when certain groups are underrepresented or overrepresented in the dataset",
                "causes": [
                    "Imbalanced data collection",
                    "Difficulty accessing certain populations",
                    "Sampling methods that exclude groups",
                    "Data availability disparities"
                ],
                "impact": "Model performs poorly on underrepresented groups",
                "detection_methods": [
                    "Analyze class and subgroup distributions",
                    "Compare to population demographics",
                    "Identify rare classes or groups"
                ]
            },
            "aggregation_bias": {
                "name": "Aggregation Bias",
                "description": "Occurs when distinct groups are treated as a single homogeneous group",
                "causes": [
                    "Ignoring subgroup differences",
                    "Treating diverse populations as monolithic",
                    "Over-simplification of complex demographics",
                    "Lack of subgroup-specific data"
                ],
                "impact": "Model fails to capture important differences between subgroups",
                "detection_methods": [
                    "Subgroup analysis",
                    "Stratified performance evaluation",
                    "Identify heterogeneous groups"
                ]
            },
            "algorithmic_bias": {
                "name": "Algorithmic Bias",
                "description": "Occurs when the algorithm itself introduces bias through its design or optimization",
                "causes": [
                    "Biased loss functions",
                    "Optimization objectives that favor certain groups",
                    "Feature selection methods that introduce bias",
                    "Regularization that disproportionately affects certain groups"
                ],
                "impact": "Model architecture or training process systematically disadvantages certain groups",
                "detection_methods": [
                    "Analyze algorithmic assumptions",
                    "Review optimization objectives",
                    "Test different algorithmic approaches"
                ]
            },
            "deployment_bias": {
                "name": "Deployment Bias",
                "description": "Occurs when model is used in contexts different from its intended use",
                "causes": [
                    "Using model on different populations",
                    "Different environmental conditions",
                    "Changes in data distribution over time",
                    "Misalignment between training and deployment contexts"
                ],
                "impact": "Model performance degrades or becomes biased in new contexts",
                "detection_methods": [
                    "Monitor performance in deployment",
                    "Regular retraining and validation",
                    "Context-specific evaluation"
                ]
            }
        }
    
    def _initialize_bias_examples(self) -> Dict[str, List[Dict[str, str]]]:
        """Initialize real-world bias examples"""
        return {
            "image_classification": [
                {
                    "example": "Facial recognition systems performing poorly on darker skin tones",
                    "bias_type": "representation_bias",
                    "description": "Training datasets historically overrepresented lighter-skinned individuals",
                    "impact": "Higher error rates for people of color in security and authentication systems",
                    "mitigation": "Collect diverse training data, use balanced datasets, test across skin tones"
                },
                {
                    "example": "Gender classification misclassifying non-binary or gender-nonconforming individuals",
                    "bias_type": "label_bias",
                    "description": "Binary gender labels in training data don't reflect gender diversity",
                    "impact": "Exclusion and misclassification of non-binary individuals",
                    "mitigation": "Use inclusive labeling schemes, avoid binary classification when inappropriate"
                }
            ],
            "object_detection": [
                {
                    "example": "Pedestrian detection systems failing to detect children or wheelchair users",
                    "bias_type": "representation_bias",
                    "description": "Training data primarily contains adult pedestrians in standard poses",
                    "impact": "Safety risks for vulnerable populations in autonomous vehicles",
                    "mitigation": "Include diverse pedestrian types, test on edge cases"
                },
                {
                    "example": "Object detection biased toward objects common in Western households",
                    "bias_type": "cultural_bias",
                    "description": "Training data from Western countries may not include objects from other cultures",
                    "impact": "Poor performance on culturally diverse environments",
                    "mitigation": "Use globally diverse datasets, cultural awareness in data collection"
                }
            ],
            "medical_imaging": [
                {
                    "example": "Skin lesion detection performing poorly on darker skin",
                    "bias_type": "representation_bias",
                    "description": "Medical imaging datasets historically underrepresented darker skin tones",
                    "impact": "Healthcare disparities and delayed diagnoses for people of color",
                    "mitigation": "Diverse medical datasets, skin-tone aware evaluation"
                },
                {
                    "example": "X-ray analysis trained on equipment from specific manufacturers",
                    "bias_type": "measurement_bias",
                    "description": "Different imaging equipment produces different image characteristics",
                    "impact": "Poor performance when deployed with different equipment",
                    "mitigation": "Multi-center training, equipment-agnostic features"
                }
            ],
            "general_examples": [
                {
                    "example": "Hiring AI screening out resumes from certain zip codes",
                    "bias_type": "proxy_bias",
                    "description": "Zip code can be a proxy for socioeconomic status and race",
                    "impact": "Discrimination against candidates from disadvantaged areas",
                    "mitigation": "Remove proxy variables, focus on job-relevant features"
                },
                {
                    "example": "Credit scoring models with lower scores for certain demographic groups",
                    "bias_type": "historical_bias",
                    "description": "Historical lending discrimination reflected in training data",
                    "impact": "Perpetuation of financial inequality",
                    "mitigation": "Fairness constraints, regular bias audits, alternative data sources"
                }
            ]
        }
    
    def _initialize_mitigation_strategies(self) -> Dict[str, Dict[str, Any]]:
        """Initialize bias mitigation strategies"""
        return {
            "pre_processing": {
                "name": "Pre-processing Mitigation",
                "description": "Address bias before model training",
                "techniques": [
                    {
                        "technique": "Reweighting",
                        "description": "Assign different weights to samples to balance representation",
                        "when_to_use": "When dataset has known imbalances",
                        "pros": ["Simple to implement", "Preserves original data"],
                        "cons": ["May not address all bias types", "Requires knowing sensitive attributes"]
                    },
                    {
                        "technique": "Resampling",
                        "description": "Oversample underrepresented groups or undersample overrepresented groups",
                        "when_to_use": "When clear class imbalance exists",
                        "pros": ["Effective for class imbalance", "Easy to understand"],
                        "cons": ["Can lead to overfitting", "May lose information in undersampling"]
                    },
                    {
                        "technique": "Data Augmentation",
                        "description": "Create synthetic samples for underrepresented groups",
                        "when_to_use": "When limited data for certain groups",
                        "pros": ["Increases diversity", "Can improve generalization"],
                        "cons": ["May not reflect real distribution", "Quality depends on augmentation method"]
                    },
                    {
                        "technique": "Feature Removal/Transformation",
                        "description": "Remove or transform features that introduce bias",
                        "when_to_use": "When proxy variables are identified",
                        "pros": ["Directly addresses bias sources", "Can be transparent"],
                        "cons": ["May lose useful information", "Proxies may be hard to identify"]
                    }
                ]
            },
            "in_processing": {
                "name": "In-processing Mitigation",
                "description": "Address bias during model training",
                "techniques": [
                    {
                        "technique": "Fairness Constraints",
                        "description": "Add fairness penalties to the loss function",
                        "when_to_use": "When fairness is a primary concern",
                        "pros": ["Directly optimizes for fairness", "Can balance accuracy and fairness"],
                        "cons": ["May reduce overall accuracy", "Requires careful tuning"]
                    },
                    {
                        "technique": "Adversarial Debiasing",
                        "description": "Train adversary to predict sensitive attributes from model predictions",
                        "when_to_use": "When sensitive attributes should not be inferable",
                        "pros": ["Effective at removing sensitive information", "Theoretically grounded"],
                        "cons": ["Complex to implement", "May impact model performance"]
                    },
                    {
                        "technique": "Regularization",
                        "description": "Add regularization to encourage similar performance across groups",
                        "when_to_use": "When subgroup performance varies significantly",
                        "pros": ["Improves generalization", "Reduces overfitting"],
                        "cons": ["May not directly address fairness", "Requires careful tuning"]
                    }
                ]
            },
            "post_processing": {
                "name": "Post-processing Mitigation",
                "description": "Address bias after model training",
                "techniques": [
                    {
                        "technique": "Threshold Adjustment",
                        "description": "Use different decision thresholds for different groups",
                        "when_to_use": "When false positive/negative rates need balancing",
                        "pros": ["Simple to implement", "Doesn't require retraining"],
                        "cons": ["May be seen as unfair", "Requires monitoring"]
                    },
                    {
                        "technique": "Calibrated Equalized Odds",
                        "description": "Adjust predictions to satisfy equalized odds constraints",
                        "when_to_use": "When equal TPR and FPR across groups is required",
                        "pros": ["Theoretically sound", "Preserves ranking"],
                        "cons": ["Complex to implement", "May reduce overall accuracy"]
                    },
                    {
                        "technique": "Reject Option Classification",
                        "description": "Reject predictions near decision boundary for disadvantaged groups",
                        "when_to_use": "When uncertain predictions should be flagged",
                        "pros": ["Human-in-the-loop", "Reduces high-stakes errors"],
                        "cons": ["Increases manual review", "May not scale well"]
                    }
                ]
            }
        }
    
    def _initialize_checklist(self) -> List[Dict[str, Any]]:
        """Initialize bias detection and mitigation checklist"""
        return [
            {
                "category": "Data Collection",
                "items": [
                    "Have you documented the data collection process?",
                    "Is the sample representative of the target population?",
                    "Have you checked for missing data patterns?",
                    "Are there known biases in the data sources?",
                    "Have you considered the historical context of the data?"
                ]
            },
            {
                "category": "Data Analysis",
                "items": [
                    "Have you analyzed class distributions?",
                    "Have you checked for imbalances across demographic groups?",
                    "Have you identified potential proxy variables?",
                    "Have you analyzed feature distributions across groups?",
                    "Have you reviewed label consistency?"
                ]
            },
            {
                "category": "Model Development",
                "items": [
                    "Have you considered fairness constraints in the loss function?",
                    "Have you tested different architectures for fairness?",
                    "Have you used appropriate evaluation metrics?",
                    "Have you performed cross-validation with stratification?",
                    "Have you documented model limitations?"
                ]
            },
            {
                "category": "Evaluation",
                "items": [
                    "Have you evaluated performance across subgroups?",
                    "Have you calculated fairness metrics (demographic parity, equalized odds)?",
                    "Have you tested on out-of-distribution data?",
                    "Have you performed error analysis across groups?",
                    "Have you compared to baseline models?"
                ]
            },
            {
                "category": "Deployment",
                "items": [
                    "Have you established monitoring for performance drift?",
                    "Have you set up alerts for fairness degradation?",
                    "Have you documented intended use cases?",
                    "Have you documented out-of-scope use cases?",
                    "Have you established a feedback mechanism?"
                ]
            },
            {
                "category": "Documentation",
                "items": [
                    "Have you created a model card?",
                    "Have you documented known biases?",
                    "Have you documented mitigation strategies?",
                    "Have you documented data sources and collection methods?",
                    "Have you documented ethical considerations?"
                ]
            }
        ]
    
    def get_bias_type_info(self, bias_type: str) -> Dict[str, str]:
        """Get detailed information about a specific bias type"""
        return self.bias_types.get(bias_type, {})
    
    def get_bias_examples(self, domain: str = None) -> List[Dict[str, str]]:
        """Get bias examples, optionally filtered by domain"""
        if domain:
            return self.bias_examples.get(domain, [])
        else:
            all_examples = []
            for examples in self.bias_examples.values():
                all_examples.extend(examples)
            return all_examples
    
    def get_mitigation_strategies(self, stage: str = None) -> Dict[str, Any]:
        """Get mitigation strategies, optionally filtered by stage"""
        if stage:
            return self.mitigation_strategies.get(stage, {})
        else:
            return self.mitigation_strategies
    
    def get_checklist(self, category: str = None) -> List[Dict[str, Any]]:
        """Get checklist items, optionally filtered by category"""
        if category:
            for cat in self.checklist:
                if cat["category"] == category:
                    return cat["items"]
            return []
        else:
            return self.checklist
    
    def search_bias_info(self, query: str) -> List[Dict[str, str]]:
        """Search bias information by keyword"""
        results = []
        query_lower = query.lower()
        
        # Search bias types
        for bias_type, info in self.bias_types.items():
            if query_lower in info["name"].lower() or query_lower in info["description"].lower():
                results.append({
                    "type": "bias_type",
                    "name": info["name"],
                    "description": info["description"]
                })
        
        # Search examples
        for domain, examples in self.bias_examples.items():
            for example in examples:
                if query_lower in example["example"].lower() or query_lower in example["description"].lower():
                    results.append({
                        "type": "example",
                        "domain": domain,
                        "example": example["example"],
                        "description": example["description"]
                    })
        
        return results
    
    def generate_bias_report(self, detected_biases: List[str]) -> str:
        """
        Generate a bias report based on detected biases
        
        Args:
            detected_biases: List of bias types detected
            
        Returns:
            Formatted bias report
        """
        report = []
        report.append("=" * 60)
        report.append("BIAS ANALYSIS REPORT")
        report.append("=" * 60)
        
        if not detected_biases:
            report.append("\nNo specific biases detected.")
            report.append("\nHowever, it's recommended to:")
            report.append("- Regularly monitor for bias")
            report.append("- Use diverse training data")
            report.append("- Perform fairness audits")
        else:
            report.append(f"\nDetected Biases: {len(detected_biases)}")
            report.append("")
            
            for bias in detected_biases:
                info = self.get_bias_type_info(bias)
                if info:
                    report.append(f"\n## {info['name']}")
                    report.append(f"Description: {info['description']}")
                    report.append(f"\nCauses:")
                    for cause in info['causes']:
                        report.append(f"  - {cause}")
                    report.append(f"\nDetection Methods:")
                    for method in info['detection_methods']:
                        report.append(f"  - {method}")
                    
                    # Get relevant examples
                    examples = self.get_bias_examples()
                    relevant_examples = [e for e in examples if e.get('bias_type') == bias]
                    if relevant_examples:
                        report.append(f"\nReal-world Examples:")
                        for ex in relevant_examples[:2]:  # Show up to 2 examples
                            report.append(f"  - {ex['example']}")
        
        report.append("\n" + "=" * 60)
        report.append("MITIGATION RECOMMENDATIONS")
        report.append("=" * 60)
        
        for stage, strategies in self.mitigation_strategies.items():
            report.append(f"\n## {strategies['name']}")
            report.append(strategies['description'])
            report.append("\nTechniques:")
            for technique in strategies['techniques']:
                report.append(f"\n  {technique['technique']}")
                report.append(f"  - {technique['description']}")
                report.append(f"  - When to use: {technique['when_to_use']}")
        
        report.append("\n" + "=" * 60)
        
        return "\n".join(report)
    
    def export_to_json(self, filepath: str):
        """Export bias resources to JSON file"""
        data = {
            "bias_types": self.bias_types,
            "bias_examples": self.bias_examples,
            "mitigation_strategies": self.mitigation_strategies,
            "checklist": self.checklist
        }
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
