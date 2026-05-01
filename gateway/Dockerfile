FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN addgroup --system aight && adduser --system --ingroup aight aight

COPY gateway/requirements.txt /app/gateway/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /app/gateway/requirements.txt

COPY gateway /app/gateway

RUN mkdir -p /data && chown -R aight:aight /app /data

USER aight

EXPOSE 8787

CMD ["uvicorn", "gateway.main:app", "--host", "0.0.0.0", "--port", "8787"]
