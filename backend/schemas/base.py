from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    """Base for response models. Extra keys are kept so documenting a response never drops data
    (many payloads are assembled from services and carry more fields than the ones typed here)."""
    model_config = ConfigDict(extra="allow")


class OkResponse(ApiModel):
    ok: bool


class SuccessResponse(ApiModel):
    success: bool
