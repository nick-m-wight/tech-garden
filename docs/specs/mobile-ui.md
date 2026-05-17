# Phone App — UI Specs

## PlantAnalysis screen flow
1. Receive from backend: `{ photoBase64, annotationPoints, diagnosis, recommendations, trimming }`
2. Display photo full-screen
3. Overlay `annotationPoints` as coloured circles with labels (react-native-skia canvas)
4. Swipe up: full diagnosis report card
5. Swipe left/right: navigate plant history
6. "Send to HA" button: trigger recommended watering/care action (requires confirmation tap)

## AnnotatedImage component props

```typescript
interface AnnotatedImageProps {
  imageBase64: string;
  annotations: Array<{
    x: number;        // 0-1 normalised coordinate
    y: number;        // 0-1 normalised coordinate
    label: string;
    color: string;    // hex
  }>;
  onAnnotationPress?: (label: string) => void;
}
```

## Screens
- `GardenDashboard.tsx` — zone overview, sensor summary
- `PlantAnalysis.tsx` — annotated photo + diagnosis
- `ZoneMap.tsx` — zone layout and status
- `PlantHistory.tsx` — browse past analyses, swipe navigation
