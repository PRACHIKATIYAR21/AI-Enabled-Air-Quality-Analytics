

from flask import Flask, jsonify, send_from_directory
import pandas as pd
import requests
import joblib
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)

# ThingSpeak configuration
CHANNEL_ID = os.getenv("CHANNEL_ID")
READ_API_KEY = os.getenv("READ_API_KEY")

# Load trained ML model
model = joblib.load("air_quality_pipeline.pkl")

def calculate_subindex(concentration, breakpoints, aqi_ranges):

    if concentration < breakpoints[0]:
        return 0

    for i in range(len(breakpoints) - 1):

        bp_low = breakpoints[i]
        bp_high = breakpoints[i + 1]

        aqi_low = aqi_ranges[i]
        aqi_high = aqi_ranges[i + 1]

        if bp_low <= concentration <= bp_high:

            aqi = (
                (aqi_high - aqi_low) /
                (bp_high - bp_low)
            ) * (concentration - bp_low) + aqi_low

            return round(aqi)

    return 500


def calculate_estimated_aqi(pm25, pm10):

    pm25_aqi = calculate_subindex(
        pm25,
        [0, 31, 61, 91, 121, 250],
        [0, 50, 100, 200, 300, 400]
    )

    pm10_aqi = calculate_subindex(
        pm10,
        [0, 51, 101, 251, 351, 430],
        [0, 50, 100, 200, 300, 400]
    )

    return max(pm25_aqi, pm10_aqi)
    
def generate_smart_alerts(sensors, estimated_aqi, prediction):

    alerts = []

    # 1. AQI-based alerts
    if estimated_aqi > 200:
        alerts.append({
            "type": "danger",
            "title": "Poor Air Quality Detected",
            "message": "The estimated AQI is above 200.",
            "precautions": [
                "Improve room ventilation.",
                "Check possible dust or pollution sources.",
                "Recheck air quality after ventilation."
            ]
        })

    elif estimated_aqi > 100:
        alerts.append({
            "type": "warning",
            "title": "Moderate Air Quality",
            "message": "The estimated AQI is above 100.",
            "precautions": [
                "Monitor PM2.5 and PM10 readings.",
                "Check room ventilation.",
                "Avoid activities that generate dust."
            ]
        })

    # 2. Temperature advisory
    if sensors["temperature"] > 35:
        alerts.append({
            "type": "warning",
            "title": "High Temperature",
            "message": "Room temperature is above 35°C.",
            "precautions": [
                "Improve room ventilation or cooling.",
                "Check the AC or ventilation system."
            ]
        })

    # 3. Humidity advisory
    if sensors["humidity"] > 70:
        alerts.append({
            "type": "warning",
            "title": "High Humidity",
            "message": "Humidity is above 70%.",
            "precautions": [
                "Improve ventilation.",
                "Check for moisture or dampness."
            ]
        })

    elif sensors["humidity"] < 30:
        alerts.append({
            "type": "info",
            "title": "Low Humidity",
            "message": "Humidity is below 30%.",
            "precautions": [
                "Monitor indoor comfort conditions."
            ]
        })

    # 4. Model prediction advisory
    if str(prediction).upper() == "BAD" and estimated_aqi <= 200:
        alerts.append({
            "type": "warning",
            "title": "ML Model Warning",
            "message": "The Decision Tree model predicts Bad air quality.",
            "precautions": [
                "Check the PM2.5 reading.",
                "Review recent sensor readings."
            ]
        })

    return alerts




# Fetch latest sensor readings from ThingSpeak
def get_thingspeak_data():

    if not CHANNEL_ID or not READ_API_KEY:
        raise ValueError("ThingSpeak credentials are missing in .env file")

    url = f"https://api.thingspeak.com/channels/{CHANNEL_ID}/feeds/last.json"

    params = {"api_key": READ_API_KEY}

    response = requests.get(url, params=params, timeout=15)
    response.raise_for_status()

    reading = response.json()

    fields = [
        reading.get("field1"),
        reading.get("field2"),
        reading.get("field3"),
        reading.get("field4"),
        reading.get("field5"),
        reading.get("field6")
    ]

    if any(value is None for value in fields):
        raise ValueError("Incomplete sensor readings received from ThingSpeak")

    input_data = pd.DataFrame([{
        "temperature": float(reading["field1"]),
        "humidity": float(reading["field2"]),
        "light": float(reading["field3"]),
        "mq135": float(reading["field4"]),
        "pm2.5": float(reading["field5"]),
        "pm10": float(reading["field6"])
    }])

    return input_data, reading





# Main dashboard page
@app.route("/")
def home():
    return send_from_directory(".", "index.html")


# CSS file
@app.route("/style.css")
def style():
    return send_from_directory(".", "style.css")


# JavaScript file
@app.route("/script.js")
def script():
    return send_from_directory(".", "script.js")


# Latest readings and ML prediction

@app.route("/api/dashboard")
def dashboard():

    try:
        input_data, reading = get_thingspeak_data()

        prediction = model.predict(input_data)[0]

        # First get sensor readings
        sensors = input_data.iloc[0].to_dict()

        # Then calculate estimated AQI
        estimated_aqi = calculate_estimated_aqi(
            sensors["pm2.5"],
            sensors["pm10"]
        )
        alerts = generate_smart_alerts(
    sensors,
    estimated_aqi,
    prediction
)

        return jsonify({
            "project_name": "AI Enabled Unified Real-Time Air Quality Analytics",
            "data_source": "ThingSpeak",
            "last_updated": reading.get("created_at"),
            "prediction": str(prediction).upper(),
            "estimated_aqi": estimated_aqi,
            "alerts": alerts,
"alert_count": len(alerts),

            "explanation": (
                "Prediction generated by the trained Decision Tree model. "
                "PM2.5 is its primary feature."
            ),

            "model": {
                "name": "Decision Tree",
                "primary_feature": "PM2.5"
            },

            "sensors": {
                "temperature": sensors["temperature"],
                "humidity": sensors["humidity"],
                "light": sensors["light"],
                "mq135": sensors["mq135"],
                "pm25": sensors["pm2.5"],
                "pm10": sensors["pm10"]
            }
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500



# Historical readings for dashboard graphs
@app.route("/api/history")
def history():

    try:
        url = f"https://api.thingspeak.com/channels/{CHANNEL_ID}/feeds.json"

        params = {
            "api_key": READ_API_KEY,
            "results": 30
        }

        response = requests.get(url, params=params, timeout=15)
        response.raise_for_status()

        feeds = response.json().get("feeds", [])

        records = []

        for item in feeds:

            try:
                fields = [
                    item.get(f"field{i}")
                    for i in range(1, 7)
                ]

                if any(value is None for value in fields):
                    continue

                records.append({
                    "timestamp": item.get("created_at"),
                    "temperature": float(item["field1"]),
                    "humidity": float(item["field2"]),
                    "light": float(item["field3"]),
                    "mq135": float(item["field4"]),
                    "pm25": float(item["field5"]),
                    "pm10": float(item["field6"])
                })

            except (ValueError, TypeError):
                continue

        return jsonify({
            "labels": [
                pd.to_datetime(r["timestamp"]).strftime("%d %b %H:%M")
                for r in records
            ],
            "temperature": [r["temperature"] for r in records],
            "humidity": [r["humidity"] for r in records],
            "pm25": [r["pm25"] for r in records],
            "pm10": [r["pm10"] for r in records],
            "data_source": "ThingSpeak"
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False,
        use_reloader=False,
        threaded=True
    )
