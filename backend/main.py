from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend.api.routes import router as api_router
from backend.database import init_db


app = FastAPI(
    title=settings.app_name,
    description="AI-Assisted ECG Analysis Platform — Doctor-in-the-loop decision support",
    version="0.1.0",
    debug=settings.debug,
)

# Allow the Next.js dev server (and common local origins) to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    init_db()


# API routes
app.include_router(api_router, prefix="/api")


@app.get("/")
async def root():
    """Service info — the UI is the Next.js app in frontend/ (own dev server)."""
    return {
        "message": f"{settings.app_name} — API is running. "
                   "Visit /docs for API documentation."
    }
