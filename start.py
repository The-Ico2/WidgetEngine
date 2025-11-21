from flask import Flask, jsonify, url_for, render_template
from flask_cors import CORS
from api.api_routes import widgets_bp

app = Flask(__name__)
CORS(app, supports_credentials=True)

# Register widget API
app.register_blueprint(widgets_bp)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api")
def api():
    return jsonify(
        name="Widget Engine API",
        version="1.0",
        status="active"
    )

if __name__ == "__main__":
    app.run(debug=True, port=7000)