import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ShapeBlurProps {
  className?: string;
  variation?: 0 | 1 | 2 | 3;
  pixelRatioProp?: number;
  shapeSize?: number;
  roundness?: number;
  borderSize?: number;
  circleSize?: number;
  circleEdge?: number;
  color?: string;
  idleBlurMin?: number;
  idleBlurMax?: number;
  idleSpeed?: number;
  idleFocusRadius?: number;
  idleFocusEdge?: number;
  idleOrbitRadiusX?: number;
  idleOrbitRadiusY?: number;
  idleOrbitCenterX?: number;
  idleOrbitCenterY?: number;
  interactionBlurMin?: number;
  interactionBlurMax?: number;
  interactionResponseDistance?: number;
}

const vertexShader = /* glsl */ `
varying vec2 v_texcoord;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  v_texcoord = uv;
}
`;

const fragmentShader = /* glsl */ `
varying vec2 v_texcoord;

uniform vec2 u_mouse;
uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform float u_interaction;
uniform float u_idleBlurMin;
uniform float u_idleBlurMax;
uniform float u_idleFocusRadius;
uniform float u_idleFocusEdge;
uniform float u_interactionBlurMin;
uniform float u_interactionBlurMax;
uniform vec3 u_color;

uniform float u_shapeSize;
uniform float u_roundness;
uniform float u_borderSize;
uniform float u_circleSize;
uniform float u_circleEdge;

#ifndef PI
#define PI 3.1415926535897932384626433832795
#endif
#ifndef TWO_PI
#define TWO_PI 6.2831853071795864769252867665590
#endif
#ifndef VAR
#define VAR 0
#endif

#ifndef FNC_COORD
#define FNC_COORD
vec2 coord(in vec2 p) {
  p = p / u_resolution.xy;
  if (u_resolution.x > u_resolution.y) {
    p.x *= u_resolution.x / u_resolution.y;
    p.x += (u_resolution.y - u_resolution.x) / u_resolution.y / 2.0;
  } else {
    p.y *= u_resolution.y / u_resolution.x;
    p.y += (u_resolution.x - u_resolution.y) / u_resolution.x / 2.0;
  }
  p -= 0.5;
  p *= vec2(-1.0, 1.0);
  return p;
}
#endif

#define st0 coord(gl_FragCoord.xy)
#define mx coord(u_mouse * u_pixelRatio)

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 d = abs(p - 0.5) * 4.2 - b + vec2(r);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

float sdCircle(in vec2 st, in vec2 center) {
  return length(st - center) * 2.0;
}

float sdPoly(in vec2 p, in float w, in int sides) {
  float a = atan(p.x, p.y) + PI;
  float r = TWO_PI / float(sides);
  float d = cos(floor(0.5 + a / r) * r - a) * length(max(abs(p) * 1.0, 0.0));
  return d * 2.0 - w;
}

float aastep(float threshold, float value) {
  float afwidth = length(vec2(dFdx(value), dFdy(value))) * 0.70710678118654757;
  return smoothstep(threshold - afwidth, threshold + afwidth, value);
}

float fill(in float x) {
  return 1.0 - aastep(0.0, x);
}

float fill(float x, float size, float edge) {
  return 1.0 - smoothstep(size - edge, size + edge, x);
}

float strokeAA(float x, float size, float w, float edge) {
  float afwidth = length(vec2(dFdx(x), dFdy(x))) * 0.70710678;
  float d = smoothstep(size - edge - afwidth, size + edge + afwidth, x + w * 0.5)
    - smoothstep(size - edge - afwidth, size + edge + afwidth, x - w * 0.5);
  return clamp(d, 0.0, 1.0);
}

void main() {
  vec2 st = st0 + 0.5;
  vec2 posMouse = mx * vec2(1.0, -1.0) + 0.5;

  float idle = 1.0 - u_interaction;
  float size = u_shapeSize;
  float roundness = u_roundness;
  float borderSize = u_borderSize;

  float idleBlurMask = fill(sdCircle(st, posMouse), u_idleFocusRadius, u_idleFocusEdge);
  float interactionBlurMask = fill(sdCircle(st, posMouse), u_circleSize, u_circleEdge);
  float idleBlur = mix(u_idleBlurMin, u_idleBlurMax, idleBlurMask) * idle;
  float interactionBlur = mix(u_interactionBlurMin, u_interactionBlurMax, interactionBlurMask) * u_interaction;
  float edgeBlur = idleBlur + interactionBlur;
  float sdf;

  if (VAR == 0) {
    sdf = sdRoundRect(st, vec2(size), roundness);
    sdf = strokeAA(sdf, 0.0, borderSize, edgeBlur) * 4.0;
  } else if (VAR == 1) {
    sdf = sdCircle(st, vec2(0.5));
    sdf = fill(sdf, 0.6, edgeBlur) * 1.2;
  } else if (VAR == 2) {
    sdf = sdCircle(st, vec2(0.5));
    sdf = strokeAA(sdf, 0.58, 0.02, edgeBlur) * 4.0;
  } else if (VAR == 3) {
    sdf = sdPoly(st - vec2(0.5, 0.45), 0.3, 3);
    sdf = fill(sdf, 0.05, edgeBlur) * 1.4;
  }

  gl_FragColor = vec4(u_color, sdf);
}
`;

export function ShapeBlur({
  className = '',
  variation = 0,
  pixelRatioProp = 2,
  shapeSize = 1.05,
  roundness = 0.42,
  borderSize = 0.045,
  circleSize = 0.34,
  circleEdge = 0.58,
  color = '#df7d57',
  idleBlurMin = 0.13,
  idleBlurMax = 0.2,
  idleSpeed = 1,
  idleFocusRadius = 0.34,
  idleFocusEdge = 0.58,
  idleOrbitRadiusX = 0.08,
  idleOrbitRadiusY = 0.06,
  idleOrbitCenterX = 0.57,
  idleOrbitCenterY = 0.43,
  interactionBlurMin = 0,
  interactionBlurMax = 1,
  interactionResponseDistance = 80,
}: ShapeBlurProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    let active = true;
    let animationFrameId = 0;
    let lastTime = performance.now() * 0.001;
    let width = 1;
    let height = 1;
    let hasPointerInteraction = false;
    let interactionProgress = 0;

    const pointer = new THREE.Vector2();
    const dampedPointer = new THREE.Vector2();
    const resolution = new THREE.Vector2();
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera();
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        u_mouse: { value: dampedPointer },
        u_resolution: { value: resolution },
        u_pixelRatio: { value: pixelRatioProp },
        u_interaction: { value: 0 },
        u_idleBlurMin: { value: idleBlurMin },
        u_idleBlurMax: { value: idleBlurMax },
        u_idleFocusRadius: { value: idleFocusRadius },
        u_idleFocusEdge: { value: idleFocusEdge },
        u_interactionBlurMin: { value: interactionBlurMin },
        u_interactionBlurMax: { value: interactionBlurMax },
        u_color: { value: new THREE.Color(color) },
        u_shapeSize: { value: shapeSize },
        u_roundness: { value: roundness },
        u_borderSize: { value: borderSize },
        u_circleSize: { value: circleSize },
        u_circleEdge: { value: circleEdge },
      },
      defines: { VAR: variation },
      transparent: true,
    });
    const quad = new THREE.Mesh(geometry, material);

    camera.position.z = 1;
    scene.add(quad);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const resize = () => {
      if (!active) {
        return;
      }

      width = Math.max(1, mount.clientWidth);
      height = Math.max(1, mount.clientHeight);
      const dpr = Math.min(pixelRatioProp || window.devicePixelRatio || 1, 2);

      renderer.setSize(width, height, false);
      renderer.setPixelRatio(dpr);

      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.updateProjectionMatrix();

      quad.scale.set(width, height, 1);
      resolution.set(width, height).multiplyScalar(dpr);
      material.uniforms.u_pixelRatio.value = dpr;
      pointer.set(width * idleOrbitCenterX, height * idleOrbitCenterY);
      dampedPointer.copy(pointer);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const centerX = rect.width * 0.5;
      const centerY = rect.height * 0.5;
      const bodyRadius = Math.min(rect.width, rect.height) * Math.max(0.08, shapeSize * 0.28);
      const distanceFromBody = Math.max(0, Math.hypot(localX - centerX, localY - centerY) - bodyRadius);
      const shouldRespond = distanceFromBody <= interactionResponseDistance;

      hasPointerInteraction = shouldRespond;
      if (shouldRespond) {
        pointer.set(localX, localY);
      }
    };

    const update = () => {
      if (!active) {
        return;
      }

      const now = performance.now() * 0.001;
      const delta = now - lastTime;
      lastTime = now;

      if (!hasPointerInteraction) {
        pointer.set(
          width * (idleOrbitCenterX + Math.sin(now * 0.45 * idleSpeed) * idleOrbitRadiusX),
          height * (idleOrbitCenterY + Math.cos(now * 0.38 * idleSpeed) * idleOrbitRadiusY),
        );
      }

      interactionProgress = THREE.MathUtils.damp(interactionProgress, hasPointerInteraction ? 1 : 0, 3.6, delta);
      material.uniforms.u_interaction.value = interactionProgress;
      dampedPointer.x = THREE.MathUtils.damp(dampedPointer.x, pointer.x, 7, delta);
      dampedPointer.y = THREE.MathUtils.damp(dampedPointer.y, pointer.y, 7, delta);
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(update);
    };

    resize();
    update();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', handlePointerMove);

    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    return () => {
      active = false;
      cancelAnimationFrame(animationFrameId);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', handlePointerMove);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [
    variation,
    pixelRatioProp,
    shapeSize,
    roundness,
    borderSize,
    circleSize,
    circleEdge,
    color,
    idleBlurMin,
    idleBlurMax,
    idleSpeed,
    idleFocusRadius,
    idleFocusEdge,
    idleOrbitRadiusX,
    idleOrbitRadiusY,
    idleOrbitCenterX,
    idleOrbitCenterY,
    interactionBlurMin,
    interactionBlurMax,
    interactionResponseDistance,
  ]);

  return <div ref={mountRef} className={className} />;
}
