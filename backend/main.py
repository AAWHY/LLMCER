from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import datasets, pipeline, config_api, logs

app = FastAPI(
    title="LLM4ER API",
    description="Backend API for LLM-based Entity Resolution",
    version="0.1.0",
)

# CORS — allow the Vite dev server and common local origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://0.0.0.0:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(datasets.router)
app.include_router(pipeline.router)
app.include_router(config_api.router)
app.include_router(logs.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
