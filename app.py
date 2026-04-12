import os
import json
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify
from openai import OpenAI

env_path = Path(__file__).parent / ".env.local"
load_dotenv(env_path)

app = Flask(__name__)

VISION_MODEL = "gpt-4o-mini"

VALID_CATEGORIES = [
    "arrangement", "frist", "beskjed", "trening", "møte", "annet"
]

SYSTEM_PROMPT = """Du analyserer bilder av beskjeder, invitasjoner, skjermbilder og dokumenter for norske foreldre.
Les all synlig tekst. Avgjør om innholdet beskriver et arrangement, en frist, en beskjed, trening, et møte, eller annet.

Svar med ETT JSON-objekt (ingen markdown-kodeblokker) med nøyaktig disse nøklene:
- title: kort tittel på norsk (string)
- date: dato som tekst hvis funnet, ellers null (string | null)
- time: klokkeslett eller tidsrom hvis funnet, ellers null (string | null)
- location: sted hvis funnet, ellers null (string | null)
- description: kort oppsummering på norsk (string)
- category: én av: arrangement, frist, beskjed, trening, møte, annet
- targetGroup: hvem det gjelder (f.eks. klasse, lag, foreldre), ellers null (string | null)
- confidence: tall 0–1 for hvor sikker du er på tolkningen (number)
- extractedText: objekt med:
  - raw: transkripsjon av relevant tekst fra bildet (string)
  - language: ISO 639-1 språkkode, typisk "no" (string)
  - confidence: tall 0–1 for OCR/lesbarhet (number)

Hvis bildet ikke inneholder lesbar tekst, sett lav confidence og forklar kort i description."""


def clamp01(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.5
    return max(0.0, min(1.0, n))


def parse_category(value):
    if isinstance(value, str) and value in VALID_CATEGORIES:
        return value
    return "annet"


def normalize_extracted_text(raw):
    if not isinstance(raw, dict):
        return {"raw": "", "language": "no", "confidence": 0}
    return {
        "raw": raw.get("raw", "") if isinstance(raw.get("raw"), str) else "",
        "language": raw.get("language", "no") if isinstance(raw.get("language"), str) else "no",
        "confidence": clamp01(raw.get("confidence", 0)),
    }


def normalize_result(data):
    if not isinstance(data, dict):
        raise ValueError("Ugyldig JSON fra modellen")
    return {
        "title": data.get("title", "Uten tittel") if isinstance(data.get("title"), str) else "Uten tittel",
        "date": str(data["date"]) if data.get("date") is not None else None,
        "time": str(data["time"]) if data.get("time") is not None else None,
        "location": str(data["location"]) if data.get("location") is not None else None,
        "description": data.get("description", "Ingen beskrivelse tilgjengelig.") if isinstance(data.get("description"), str) else "Ingen beskrivelse tilgjengelig.",
        "category": parse_category(data.get("category")),
        "targetGroup": str(data["targetGroup"]) if data.get("targetGroup") is not None else None,
        "confidence": clamp01(data.get("confidence", 0.5)),
        "extractedText": normalize_extracted_text(data.get("extractedText")),
    }


def to_data_url(image: str) -> str:
    if image.startswith("data:"):
        return image
    return f"data:image/jpeg;base64,{image}"


def analyze_image(image_base64: str) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY er ikke satt i .env.local")

    client = OpenAI(api_key=api_key)
    image_url = to_data_url(image_base64)

    completion = client.chat.completions.create(
        model=VISION_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Analyser bildet og returner JSON som beskrevet."},
                    {"type": "image_url", "image_url": {"url": image_url, "detail": "auto"}},
                ],
            },
        ],
        response_format={"type": "json_object"},
        max_tokens=1500,
        temperature=0.2,
    )

    content = completion.choices[0].message.content
    if not content:
        raise RuntimeError("Tom respons fra OpenAI")

    parsed = json.loads(content)
    return normalize_result(parsed)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    try:
        body = request.get_json(force=True)
        image = body.get("image")

        if not image:
            return jsonify({"error": "Mangler bilde i request body"}), 400

        result = analyze_image(image)
        return jsonify(result)

    except Exception as e:
        print(f"[api/analyze] {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
