import React, { useState } from 'react';
import { View, Image, Text, Pressable, StyleSheet } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
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

export default function AnnotatedImage({
  imageBase64,
  annotations,
  onAnnotationPress,
}: AnnotatedImageProps) {
  const [dims, setDims] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setDims({ width, height });
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      <Image
        source={{ uri: `data:image/jpeg;base64,${imageBase64}` }}
        style={styles.image}
        resizeMode="contain"
      />
      {dims.width > 0 && (
        <View
          style={[StyleSheet.absoluteFill, { width: dims.width, height: dims.height }]}
          pointerEvents="none"
        >
          <Canvas style={{ flex: 1 }}>
            {annotations.map((a) => (
              <Circle
                key={`dot-${a.label}-${a.x}`}
                cx={a.x * dims.width}
                cy={a.y * dims.height}
                r={10}
                color={a.color}
                opacity={0.85}
              />
            ))}
          </Canvas>
        </View>
      )}
      {dims.width > 0 &&
        annotations.map((a) => (
          <Pressable
            key={`label-${a.label}-${a.x}`}
            style={[
              styles.labelBubble,
              { left: a.x * dims.width + 13, top: a.y * dims.height - 12 },
            ]}
            onPress={() => onAnnotationPress?.(a.label)}
          >
            <Text style={styles.labelText} numberOfLines={1}>
              {a.label}
            </Text>
          </Pressable>
        ))}
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
