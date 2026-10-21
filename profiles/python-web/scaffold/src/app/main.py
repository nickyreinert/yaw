from fastapi import FastAPI

app = FastAPI()


def greet(name: str) -> str:
    return f"Hello, {name}!"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/hello/{name}")
def hello(name: str) -> dict[str, str]:
    return {"message": greet(name)}
