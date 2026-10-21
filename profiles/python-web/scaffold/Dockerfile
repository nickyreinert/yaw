FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.5.31 /uv /usr/local/bin/uv
WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
ENV PATH="/srv/.venv/bin:$PATH"
RUN useradd --no-create-home app
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8000"]
