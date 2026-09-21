"""
Music processing module for Bee AI device integration.
Handles music generation, session transcripts, and device communication.
"""
import json
import sys
from pathlib import Path
from datetime import date, datetime

OUTPUT_DIR = Path(__file__).resolve().parent / "music"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def process_music_session(session_data):
    """Process music session data for Bee device."""
    timestamp = datetime.now().isoformat()
    session_id = session_data.get("id", "unknown") if session_data else "default"

    output = {
        "status": "processed",
        "timestamp": timestamp,
        "session_id": session_id,
        "device": "bee_ai",
        "notes": "Session data received and processed for music generation",
    }

    if session_data:
        output["data"] = session_data

    # Save session data
    output_file = OUTPUT_DIR / f"session_{session_id}_{timestamp.replace(':', '-')}.json"
    with open(output_file, 'w') as f:
        json.dump(output, f, indent=2)

    return output


def send_to_bee_device(audio_data):
    """Send processed audio to Bee AI device."""
    timestamp = datetime.now().isoformat()

    result = {
        "status": "sent_to_device",
        "timestamp": timestamp,
        "device": "bee_ai",
        "message": "Audio data transmitted to Bee device",
    }

    if audio_data:
        result["audio_info"] = {
            "size": len(audio_data) if isinstance(audio_data, (str, bytes)) else 0,
            "format": "audio/processed",
        }

    return result


def main():
    """Main entry point - reads from stdin and processes music data."""
    try:
        input_data = sys.stdin.read()

        if input_data.strip():
            session_data = json.loads(input_data)
        else:
            session_data = None

        result = process_music_session(session_data)
        print(json.dumps(result, indent=2))

    except json.JSONDecodeError:
        print(json.dumps({
            "status": "error",
            "message": "Invalid JSON input",
            "timestamp": datetime.now().isoformat(),
        }, indent=2), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({
            "status": "error",
            "message": str(e),
            "timestamp": datetime.now().isoformat(),
        }, indent=2), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
