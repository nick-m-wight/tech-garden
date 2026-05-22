// Pinch-to-zoom + pan view for selecting a crop region.
// A square guide overlay shows exactly what will be displayed in the analysis.
// The crop rect is computed from the square region, not the full screen.

import React, { useRef, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import type { LayoutChangeEvent, ImageLoadEventData, NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  imageBase64: string;
  mimeType?: string;
  onCrop: (rect: CropRect) => void;
  onCancel: () => void;
}

interface Size { width: number; height: number }

function fittedSize(img: Size, container: Size): Size {
  const r = img.width / img.height;
  return r > container.width / container.height
    ? { width: container.width, height: container.width / r }
    : { width: container.height * r, height: container.height };
}

export default function CropZoomView({ imageBase64, mimeType = 'image/jpeg', onCrop, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [container, setContainer] = useState<Size | null>(null);
  const [imgSize, setImgSize]     = useState<Size | null>(null);

  const scale      = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx         = useSharedValue(0);
  const ty         = useSharedValue(0);
  const savedTx    = useSharedValue(0);
  const savedTy    = useSharedValue(0);

  const scaleRef = useRef(1);
  const txRef    = useRef(0);
  const tyRef    = useRef(0);

  const syncRefs = (s: number, x: number, y: number) => {
    scaleRef.current = s;
    txRef.current    = x;
    tyRef.current    = y;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e: { scale: number }) => {
      scale.value = Math.max(1, savedScale.value * e.scale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      runOnJS(syncRefs)(scale.value, tx.value, ty.value);
    });

  const pan = Gesture.Pan()
    .onUpdate((e: { translationX: number; translationY: number }) => {
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      runOnJS(syncRefs)(scale.value, tx.value, ty.value);
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const onContainerLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer({ width, height });
  };

  const onImageLoad = (e: NativeSyntheticEvent<ImageLoadEventData>) => {
    const { width, height } = e.nativeEvent.source;
    setImgSize({ width, height });
  };

  const handleAnalyzeCrop = () => {
    if (!container || !imgSize) return;

    const s      = scaleRef.current;
    const transX = txRef.current;
    const transY = tyRef.current;

    const fitted = fittedSize(imgSize, container);

    const imgLeft = container.width  / 2 + transX - (fitted.width  * s) / 2;
    const imgTop  = container.height / 2 + transY - (fitted.height * s) / 2;

    // Compute crop rect relative to the square guide, not the full container.
    const squareSize = container.width;
    const squareTop  = (container.height - squareSize) / 2;

    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const x  = clamp(-imgLeft                          / (fitted.width  * s));
    const y  = clamp((squareTop - imgTop)              / (fitted.height * s));
    const x2 = clamp((squareSize - imgLeft)            / (fitted.width  * s));
    const y2 = clamp((squareTop + squareSize - imgTop) / (fitted.height * s));

    onCrop({ x, y, width: x2 - x, height: y2 - y });
  };

  // Square guide dimensions — full width, vertically centered.
  const squareSize = container?.width ?? 0;
  const squareTop  = container ? (container.height - squareSize) / 2 : 0;

  return (
    <View style={styles.root} onLayout={onContainerLayout}>
      <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Animated.Image
            source={{ uri: `data:${mimeType};base64,${imageBase64}` }}
            style={[styles.image, animStyle]}
            resizeMode="contain"
            onLoad={onImageLoad}
          />
        </View>
      </GestureDetector>

      {/* Dim bands above and below the square guide */}
      {container != null && (
        <>
          <View style={[styles.dimBand, { top: 0, height: squareTop }]} pointerEvents="none" />
          <View style={[styles.dimBand, { top: squareTop + squareSize, bottom: 0 }]} pointerEvents="none" />
          {/* Square border — shows exactly what will be displayed */}
          <View
            style={[styles.squareBorder, { top: squareTop, width: squareSize, height: squareSize }]}
            pointerEvents="none"
          />
        </>
      )}

      <View style={styles.hint} pointerEvents="none">
        <Text style={styles.hintText}>Zoom to fill the square • Pan to position</Text>
      </View>

      <View style={[styles.buttons, { bottom: Math.max(24, insets.bottom + 16) }]}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.analyzeBtn, (!container || !imgSize) && styles.btnDisabled]}
          onPress={handleAnalyzeCrop}
          disabled={!container || !imgSize}
        >
          <Text style={styles.analyzeText}>Analyze this area</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  image:       { width: '100%', height: '100%' },
  dimBand:     { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  squareBorder: {
    position: 'absolute',
    left: 0,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  hint: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  hintText:    { color: '#fff', fontSize: 12, opacity: 0.9 },
  buttons:     { position: 'absolute', bottom: 24, left: 16, right: 16, flexDirection: 'row', gap: 12 },
  cancelBtn:   { flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center' },
  cancelText:  { color: '#fff', fontWeight: '600', fontSize: 15 },
  analyzeBtn:  { flex: 2, paddingVertical: 14, borderRadius: 10, backgroundColor: '#2d6a4f', alignItems: 'center' },
  btnDisabled: { opacity: 0.45 },
  analyzeText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
