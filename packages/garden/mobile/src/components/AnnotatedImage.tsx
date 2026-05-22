import React, { useState } from 'react';
import { View, Image, Text, Pressable, StyleSheet } from 'react-native';
import type { LayoutChangeEvent, NativeSyntheticEvent, ImageLoadEventData } from 'react-native';
import { Canvas, Circle } from '@shopify/react-native-skia';

export interface AnnotationPoint {
  x: number;
  y: number;
  label: string;
  color: string;
}

interface AnnotatedImageProps {
  imageBase64: string;
  annotations: AnnotationPoint[];
  onAnnotationPress?: (label: string) => void;
}

// Map a normalized image coordinate (0–1) to a container pixel position,
// accounting for cover scaling so annotations sit on the actual image content.
function coverPosition(
  ax: number,
  ay: number,
  cW: number,
  cH: number,
  iW: number,
  iH: number,
): { x: number; y: number } {
  if (iW === 0 || iH === 0) return { x: ax * cW, y: ay * cH };
  const scale = Math.max(cW / iW, cH / iH);
  const offsetX = (cW - iW * scale) / 2;
  const offsetY = (cH - iH * scale) / 2;
  return { x: offsetX + ax * iW * scale, y: offsetY + ay * iH * scale };
}

export default function AnnotatedImage({
  imageBase64,
  annotations,
  onAnnotationPress,
}: AnnotatedImageProps) {
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [imgNatural, setImgNatural] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setDims({ width, height });
  };

  const onLoad = (e: NativeSyntheticEvent<ImageLoadEventData>) => {
    const { width, height } = e.nativeEvent.source;
    setImgNatural({ width, height });
  };

  const ready = dims.width > 0 && imgNatural.width > 0;

  return (
    <View style={styles.root} onLayout={onLayout}>
      <Image
        source={{ uri: `data:image/jpeg;base64,${imageBase64}` }}
        style={styles.image}
        resizeMode="cover"
        onLoad={onLoad}
      />
      {ready && (
        <View style={[StyleSheet.absoluteFill]} pointerEvents="none">
          <Canvas style={{ flex: 1 }}>
            {annotations.map((a) => {
              const pos = coverPosition(a.x, a.y, dims.width, dims.height, imgNatural.width, imgNatural.height);
              return (
                <Circle
                  key={`dot-${a.label}-${a.x}`}
                  cx={pos.x}
                  cy={pos.y}
                  r={10}
                  color={a.color}
                  opacity={0.85}
                />
              );
            })}
          </Canvas>
        </View>
      )}
      {ready &&
        annotations.map((a) => {
          const pos = coverPosition(a.x, a.y, dims.width, dims.height, imgNatural.width, imgNatural.height);
          return (
            <Pressable
              key={`label-${a.label}-${a.x}`}
              style={[styles.labelBubble, { left: pos.x + 13, top: pos.y - 12 }]}
              onPress={() => onAnnotationPress?.(a.label)}
            >
              <Text style={styles.labelText} numberOfLines={1}>
                {a.label}
              </Text>
            </Pressable>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  image: { width: '100%', height: '100%' },
  labelBubble: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    maxWidth: 120,
  },
  labelText: { color: '#fff', fontSize: 11, fontWeight: '500' },
});
