from pydantic import BaseModel, Field
from typing import Dict, Optional, List
import uuid
from datetime import datetime
import json
from pathlib import Path

class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    task_type: str
    annotation_type: Optional[str] = "bbox"  # bbox | point
    description: Optional[str] = ""
    classes: List[str] = []
    class_colors: Optional[Dict[str, str]] = {}
    created_at: datetime = Field(default_factory=datetime.now)
    owner_id: Optional[str] = "legacy"

class ProjectManager:
    def __init__(self):
        self.projects: Dict[str, Project] = {}
        self.registry_file = Path(__file__).resolve().parent / "logs" / "projects.json"
        self._load_projects()

    def _load_projects(self):
        if self.registry_file.exists():
            try:
                with open(self.registry_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        self.projects[k] = Project(**v)
            except Exception as e:
                print(f"Error loading projects: {e}")

    def save_projects(self):
        self.registry_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.registry_file, "w", encoding="utf-8") as f:
            # datetime serialization handling
            json.dump({k: v.dict() for k, v in self.projects.items()}, f, default=str)
            
    def create_project(self, project: Project) -> Project:
        self.projects[project.id] = project
        self.save_projects()
        return project

    def get_project(self, project_id: str) -> Optional[Project]:
        return self.projects.get(project_id)

    def list_projects(self) -> list[Project]:
        return sorted(list(self.projects.values()), key=lambda p: p.created_at, reverse=True)

project_manager = ProjectManager()
