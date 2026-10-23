from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "apps" / "pos" / "public"


def scale(value: int, size: int) -> int:
    return round(value * size / 512)


def generate(size: int) -> None:
    image = Image.new("RGB", (size, size), "#1f3a35")
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=scale(120, size),
        fill="#1f3a35",
    )

    draw.rounded_rectangle(
        (scale(116, size), scale(185, size), scale(396, size), scale(414, size)),
        radius=scale(70, size),
        fill="#f8f4eb",
    )
    draw.rectangle(
        (scale(116, size), scale(185, size), scale(396, size), scale(260, size)),
        fill="#f8f4eb",
    )

    draw.polygon(
        [
            (scale(102, size), scale(160, size)),
            (scale(150, size), scale(108, size)),
            (scale(218, size), scale(96, size)),
            (scale(300, size), scale(128, size)),
            (scale(360, size), scale(110, size)),
            (scale(429, size), scale(139, size)),
            (scale(403, size), scale(181, size)),
            (scale(350, size), scale(201, size)),
            (scale(270, size), scale(198, size)),
            (scale(190, size), scale(179, size)),
        ],
        fill="#e65f44",
    )

    eye_radius = scale(18, size)
    for center_x in (205, 307):
        x = scale(center_x, size)
        y = scale(279, size)
        draw.ellipse(
            (x - eye_radius, y - eye_radius, x + eye_radius, y + eye_radius),
            fill="#1f3a35",
        )

    draw.arc(
        (scale(196, size), scale(292, size), scale(316, size), scale(365, size)),
        start=18,
        end=162,
        fill="#1f3a35",
        width=max(2, scale(18, size)),
    )

    image.save(OUTPUT / f"antojit-os-{size}.png", optimize=True)


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    generate(192)
    generate(512)
