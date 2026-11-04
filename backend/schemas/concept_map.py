"""Request / response shapes for the concept map (services/concept_map_service.py)."""
from typing import Dict, List, Optional

from pydantic import BaseModel

from .base import ApiModel


class ConceptMapBuildRequest(BaseModel):
    session_id: str                       # a document id or a course id


class MapNode(ApiModel):
    id: str                               # the concept's normalised name
    name: str
    summary: str
    importance: int                       # 3 central, 2 important, 1 supporting
    pages: List[Dict]                     # [{doc_id, page}] where it is explained
    docs: List[str]                       # the documents it appears in
    heat: str                             # new | weak | learning | strong
    seen: int
    correct: int


class MapEdge(ApiModel):
    source: str
    target: str
    label: str


class MapDocument(ApiModel):
    id: str
    name: str
    status: str                           # none | queued | running | ready | failed | stalled | not_ready
    stage: Optional[str] = None
    error: Optional[str] = None


class ConceptMapResponse(ApiModel):
    scope: Dict[str, str]                 # {id, kind: document | course, name}
    status: str                           # none | building | ready | partial | failed | not_ready
    stage: Optional[str] = None           # the progress line while it builds
    built: int
    total: int
    documents: List[MapDocument]
    concepts: List[MapNode]
    relations: List[MapEdge]
