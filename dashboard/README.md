# Dashboard financiero — CRIADERO LA CABRERA SAS

Pequeña aplicación estática que visualiza indicadores financieros, la serie histórica de la TRM y una página adicional de proyecciones y valoración DCF.

Cómo ejecutar (desde la carpeta `data`):

```powershell
# Desde el directorio que contiene la carpeta dashboard
cd dashboard
# Servir con Python 3 (recomendado)
python -m http.server 8000
# Abrir en el navegador: http://localhost:8000
```

Archivos usados (debe existir en la carpeta padre):
- `CRIADERO_LA_CABRERA_SAS_900433596.json`
- `TRM_Historico_5Y.csv`

Páginas principales:
- `index.html`: dashboard histórico.
- `proyecciones.html`: proyección de estados financieros, FCFF, WACC y valor presente de las operaciones.

Supuestos base del modelo DCF:
- Crecimiento, margen operativo, capex, depreciación y capital de trabajo se inicializan con tendencias históricas y luego quedan editables.
- El valor terminal usa una tasa de crecimiento de largo plazo del 4% anual.
- El WACC usa CAPM con beta 2.0, tasa libre de riesgo 4.5% y prima de riesgo país 6%; la prima de mercado y la estructura de capital se pueden ajustar en pantalla.
