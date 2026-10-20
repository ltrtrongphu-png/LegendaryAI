(function () {
  var canvas = document.getElementById('bg-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lowEnd = Number(navigator.hardwareConcurrency || 8) <= 4 ||
    Number(navigator.deviceMemory || 8) <= 4;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 9;

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !lowEnd, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1 : 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Particle sphere ("neural orb")
  var group = new THREE.Group();
  scene.add(group);

  var staticScene = reduceMotion || lowEnd;
  var particleCount = staticScene ? (window.innerWidth < 700 ? 80 : 120) : (window.innerWidth < 700 ? 180 : 420);
  var radius = 3.4;
  var positions = new Float32Array(particleCount * 3);
  var pts = [];

  for (var i = 0; i < particleCount; i++) {
    var phi = Math.acos(-1 + (2 * i) / particleCount);
    var theta = Math.sqrt(particleCount * Math.PI) * phi;
    var x = radius * Math.cos(theta) * Math.sin(phi);
    var y = radius * Math.sin(theta) * Math.sin(phi);
    var z = radius * Math.cos(phi);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    pts.push(new THREE.Vector3(x, y, z));
  }

  var geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  var material = new THREE.PointsMaterial({
    color: 0x7EC8FF,
    size: 0.045,
    transparent: true,
    opacity: 0.9
  });
  var pointCloud = new THREE.Points(geometry, material);
  group.add(pointCloud);

  // Sparse connecting lines for a "network" feel
  var lineGeom = new THREE.BufferGeometry();
  var linePositions = [];
  var maxDist = 0.9;
  var maxLines = staticScene ? 45 : 160;
  var lineCount = 0;
  for (var a = 0; a < pts.length && lineCount < maxLines; a += 3) {
    for (var b = a + 1; b < pts.length && lineCount < maxLines; b += 7) {
      if (pts[a].distanceTo(pts[b]) < maxDist) {
        linePositions.push(pts[a].x, pts[a].y, pts[a].z, pts[b].x, pts[b].y, pts[b].z);
        lineCount++;
      }
    }
  }
  lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  var lineMat = new THREE.LineBasicMaterial({ color: 0x3E7BFA, transparent: true, opacity: 0.18 });
  var lines = new THREE.LineSegments(lineGeom, lineMat);
  group.add(lines);

  // The particle network is the hero atmosphere. Avoid a second wireframe shell
  // behind the pointer: it visually competes with the logo and made the hero feel boxed-in.
  group.position.set(2.6, 0, 0);

  var mouseX = 0, mouseY = 0;
  var mouseHandler = function (e) {
    mouseX = (e.clientX / Math.max(window.innerWidth, 1) - 0.5);
    mouseY = (e.clientY / Math.max(window.innerHeight, 1) - 0.5);
  };
  window.addEventListener('mousemove', mouseHandler, { passive: true });

  var resizeHandler = function () {
    camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (window.innerWidth < 900) {
      group.position.set(0, 0, 0);
    } else {
      group.position.set(2.6, 0, 0);
    }
    if (staticScene) renderer.render(scene, camera);
  };
  window.addEventListener('resize', resizeHandler, { passive: true });

  var clock = new THREE.Clock();
  var paused = document.hidden;
  var rafId = null;
  var visibilityHandler = function () {
    paused = document.hidden;
    if (!paused) {
      clock.getDelta();
      if (staticScene) renderer.render(scene, camera);
      else animate();
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  function dispose() {
    paused = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    window.removeEventListener('mousemove', mouseHandler);
    window.removeEventListener('resize', resizeHandler);
    document.removeEventListener('visibilitychange', visibilityHandler);
    geometry.dispose();
    material.dispose();
    lineGeom.dispose();
    lineMat.dispose();
    renderer.dispose();
    if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss();
  }
  window.addEventListener('pagehide', dispose, { once: true });

  function animate() {
    if (paused) { rafId = null; return; }
    rafId = requestAnimationFrame(animate);
    var t = clock.getElapsedTime();
    group.rotation.y = t * 0.09 + mouseX * 0.4;
    group.rotation.x = mouseY * 0.25;
    renderer.render(scene, camera);
  }

  if (staticScene) {
    renderer.render(scene, camera);
    return;
  }
  animate();
})();
