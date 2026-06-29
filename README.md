# GPS Video Overlay

Десктоп-приложение для наложения GPS-спидометра и данных телеметрии на экшен-видео — по образцу GoPro Quik. Поддерживает GoPro (GPMF), DJI (SRT субтитры) и GPX-файлы.

## Стек

- **Electron** + Node.js (Windows x64)
- **FFmpeg** / ffprobe (статическая сборка, bundled)
- **Canvas 2D API** — рендеринг оверлеев
- **gpmf-extract + gopro-telemetry** — парсинг GoPro GPMF
- **electron-store** — сохранение настроек

---

## Быстрый старт

```bash
# 1. Установите зависимости
npm install

# 2. Запустите в dev-режиме
npm start

# 3. Сборка Windows-инсталлятора (NSIS)
npm run dist
```

---

## Возможности

| Функция | Детали |
|---|---|
| **GPS-источники** | GoPro GPMF (Hero / MAX), DJI SRT, GPX |
| **Стили спидометра** | Аналоговый · Цифровой LCD · Дуга · Минимал |
| **Оверлеи** | Скорость · Мини-карта маршрута · Высота · Координаты |
| **Единицы** | km/h ↔ mph (переключается в настройках) |
| **Live preview** | Рендер в реальном времени поверх видео |
| **Позиционирование** | Drag & drop + сетка 9 позиций |
| **Экспорт** | H.264 / H.265 / ProRes, выбор CRF + preset |
| **Сглаживание GPS** | Скользящее окно 1–20 точек |

---

## Структура проекта

```
gps-video-overlay/
├── main.js              ← Electron main process
├── preload.js           ← contextBridge IPC API
├── package.json
└── src/
    ├── index.html       ← UI (3-колоночный редактор)
    ├── styles/
    │   └── app.css      ← Dark Space тема
    └── js/
        ├── speedometers.js  ← 4 стиля канвас-рендера
        ├── minimap.js       ← GPS мини-карта
        ├── overlays.js      ← Компоузитинг всех оверлеев
        ├── gps.js           ← GPS менеджер + интерполяция
        ├── export.js        ← Pipeline рендер → FFmpeg
        └── app.js           ← UI-контроллер
```

---

## Поддерживаемые камеры

- **GoPro** Hero 8 / 9 / 10 / 11 / 12 / MAX — через GPMF metadata stream
- **DJI** Mavic / Air / Mini — через SRT subtitle track
- **Любая камера** — через внешний `.gpx` файл

---

## Горячие клавиши

| Клавиша | Действие |
|---|---|
| `Space` | Воспроизведение / пауза |
| `→` / `←` | Перемотка ±5 сек |

---

## Экспорт

Перед рендером выбираете:
- **Кодек**: H.264 · H.265/HEVC · Apple ProRes
- **Качество (CRF)**: 16 (без потерь) → 28 (среднее)
- **Preset**: fast → slow

Оверлеи рендерятся в PNG-кадры (GPU Canvas) и накладываются через FFmpeg `overlay` filter.

---

## Лицензия

MIT
