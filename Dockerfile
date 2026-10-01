FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV DATABASE_PATH=/data/settle.db PORT=8000
RUN mkdir -p /data
EXPOSE 8000
CMD ["python", "server.py"]
