import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface Particle {
  id: number;
  x: number;
  y: number;
  z: number;
  size: number;
  speed: number;
  colorVariant: 'blue' | 'pink' | 'green';
}

interface Connection {
  id: string;
  from: number;
  to: number;
  opacity: number;
}

export default function ParticleField() {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [cursorRaw, setCursorRaw] = useState({ x: 0, y: 0 });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [ripples, setRipples] = useState<Array<{ id: number; timestamp: number; x: number; y: number }>>([]);
  const [syncBreathing, setSyncBreathing] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const rawX = e.clientX - centerX;
      const rawY = e.clientY - centerY;
      
      setMousePos({
        x: rawX * 0.2,
        y: rawY * 0.2,
      });
      
      setCursorRaw({ x: rawX, y: rawY });
    };
    
    const handleClick = (e: MouseEvent) => {
      // Create two ripple waves from click position
      const baseId = Date.now();
      // Convert screen coordinates to particle field coordinates (centered at 0,0)
      const clickX = e.clientX - window.innerWidth / 2;
      const clickY = e.clientY - window.innerHeight / 2;
      
      // First ripple
      const rippleId1 = baseId;
      setRipples(prev => [...prev, { id: rippleId1, timestamp: rippleId1, x: clickX, y: clickY }]);
      setTimeout(() => {
        setRipples(prev => prev.filter(r => r.id !== rippleId1));
      }, 2000);
      
      // Second ripple (slightly delayed)
      setTimeout(() => {
        const rippleId2 = baseId + 1;
        setRipples(prev => [...prev, { id: rippleId2, timestamp: rippleId2, x: clickX, y: clickY }]);
        setTimeout(() => {
          setRipples(prev => prev.filter(r => r.id !== rippleId2));
        }, 2000);
      }, 150);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick);
    };
  }, []);

  useEffect(() => {
    // Generate particles in orbital positions around center
    const newParticles: Particle[] = [];
    
    for (let i = 0; i < 55; i++) {
      const angle = (Math.PI * 2 * i) / 55;
      // Wider horizontal distribution for rectangular field
      const radiusX = 120 + Math.random() * 140; // Horizontal radius
      const radiusY = 70 + Math.random() * 80;   // Vertical radius (same as before)
      // Distribute colors: ~70% blue, ~15% pink, ~15% green
      const rand = Math.random();
      const colorVariant = rand < 0.7 ? 'blue' : rand < 0.85 ? 'pink' : 'green';
      
      newParticles.push({
        id: i,
        x: Math.cos(angle) * radiusX,
        y: Math.sin(angle) * radiusY,
        z: (Math.random() - 0.5) * 100,
        size: Math.random() * 4 + 3,
        speed: Math.random() * 15 + 20,
        colorVariant,
      });
    }
    setParticles(newParticles);
  }, []);

  // BREATHING SYNCHRONIZATION - collective moments every 10 seconds
  useEffect(() => {
    const syncInterval = setInterval(() => {
      setSyncBreathing(true);
      setTimeout(() => {
        setSyncBreathing(false);
      }, 3000); // Sync for 3 seconds
    }, 10000); // Every 10 seconds

    return () => clearInterval(syncInterval);
  }, []);
  
  // Neural network connections - update periodically
  useEffect(() => {
    const updateConnections = () => {
      const newConnections: Connection[] = [];
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // Connect particles within 30px with 15% chance
          if (distance < 30 && Math.random() > 0.85) {
            newConnections.push({
              id: `${i}-${j}`,
              from: i,
              to: j,
              opacity: 0.1,
            });
          }
        }
      }
      setConnections(newConnections);
    };
    
    updateConnections();
    const interval = setInterval(updateConnections, 500);
    return () => clearInterval(interval);
  }, [particles]);

  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-192 h-96 pointer-events-none" 
         style={{ perspective: '1000px' }}>
      {/* Ripple waves */}
      {ripples.map((ripple) => (
        <motion.div
          key={ripple.id}
          className="absolute rounded-full border-2 border-cyan-400/40 pointer-events-none"
          style={{
            left: `calc(50% + ${ripple.x}px)`,
            top: `calc(50% + ${ripple.y}px)`,
            transform: 'translate(-50%, -50%)',
          }}
          initial={{ width: 0, height: 0, opacity: 0.8 }}
          animate={{ 
            width: 500, 
            height: 500, 
            opacity: 0,
          }}
          transition={{
            duration: 2,
            ease: 'easeOut',
            type: 'tween',
          }}
        />
      ))}
      
      {/* Neural network connections */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
        {connections.map((conn) => {
          const p1 = particles[conn.from];
          const p2 = particles[conn.to];
          if (!p1 || !p2) return null;
          
          // Calculate if cursor is near the connection line
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          const distToCursor = Math.sqrt(
            Math.pow(midX - cursorRaw.x, 2) + 
            Math.pow(midY - cursorRaw.y, 2)
          );
          // Glow brighter when cursor passes near
          const cursorGlow = Math.max(0, 1 - distToCursor / 100);
          
          // Calculate line position and angle
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          
          return (
            <motion.div
              key={conn.id}
              className="absolute origin-left"
              style={{
                left: '50%',
                top: '50%',
                width: `${length}px`,
                height: `${0.5 + cursorGlow * 2}px`,
                background: `rgba(103, 232, 249, ${conn.opacity + cursorGlow * 0.4})`,
                transform: `translate(${p1.x}px, ${p1.y}px) rotate(${angle}deg)`,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            />
          );
        })}
      </div>
      
      <div
        className="relative w-full h-full"
        style={{ transformStyle: 'preserve-3d' }}
      >
        {particles.map((particle) => {
          // PROXIMITY AWARENESS - calculate distance from cursor
          const distance = Math.sqrt(
            Math.pow(particle.x - cursorRaw.x, 2) + 
            Math.pow(particle.y - cursorRaw.y, 2)
          );
          const proximityRadius = 150;
          const proximityFactor = Math.max(0, 1 - distance / proximityRadius);
          
          // TEMPERATURE/ENERGY STATES - blue → cyan → white based on proximity
          const getEnergyColor = (factor: number) => {
            if (particle.colorVariant === 'pink') {
              // Pink variant: rgb(236, 72, 153) → rgb(251, 113, 133) → white
              if (factor < 0.5) {
                const t = factor * 2;
                const r = Math.round(236 + (251 - 236) * t);
                const g = Math.round(72 + (113 - 72) * t);
                const b = Math.round(153 + (133 - 153) * t);
                return `rgb(${r}, ${g}, ${b})`;
              } else {
                const t = (factor - 0.5) * 2;
                const r = Math.round(251 + (255 - 251) * t);
                const g = Math.round(113 + (255 - 113) * t);
                const b = Math.round(133 + (255 - 133) * t);
                return `rgb(${r}, ${g}, ${b})`;
              }
            } else if (particle.colorVariant === 'green') {
              // Green variant: rgb(34, 197, 94) → rgb(74, 222, 128) → white
              if (factor < 0.5) {
                const t = factor * 2;
                const r = Math.round(34 + (74 - 34) * t);
                const g = Math.round(197 + (222 - 197) * t);
                const b = Math.round(94 + (128 - 94) * t);
                return `rgb(${r}, ${g}, ${b})`;
              } else {
                const t = (factor - 0.5) * 2;
                const r = Math.round(74 + (255 - 74) * t);
                const g = Math.round(222 + (255 - 222) * t);
                const b = Math.round(128 + (255 - 128) * t);
                return `rgb(${r}, ${g}, ${b})`;
              }
            } else {
              // Blue (cold): rgb(59, 130, 246)
              // Cyan (warm): rgb(6, 182, 212)
              // White (hot): rgb(255, 255, 255)
              if (factor < 0.5) {
                // Interpolate blue → cyan
                const t = factor * 2; // 0 to 1
                const r = Math.round(59 + (6 - 59) * t);
                const g = Math.round(130 + (182 - 130) * t);
                const b = Math.round(246 + (212 - 246) * t);
                return `rgb(${r}, ${g}, ${b})`;
              } else {
                // Interpolate cyan → white
                const t = (factor - 0.5) * 2; // 0 to 1
                const r = Math.round(6 + (255 - 6) * t);
                const g = Math.round(182 + (255 - 182) * t);
                const b = Math.round(212 + (255 - 212) * t);
                return `rgb(${r}, ${g}, ${b})`;
              }
            }
          };
          const energyColor = getEnergyColor(proximityFactor);
          
          // RIPPLE RESPONSE - particles expand/contract as wave passes
          let rippleScale = 1;
          ripples.forEach(ripple => {
            const rippleAge = Date.now() - ripple.timestamp;
            const rippleRadius = (rippleAge / 2000) * 250; // Expands to 250px over 2s
            // Distance from particle to ripple origin
            const dx = particle.x - ripple.x;
            const dy = particle.y - ripple.y;
            const particleDistance = Math.sqrt(dx * dx + dy * dy);
            // Check if ripple wave is passing through this particle (within 30px band)
            const distanceFromRipple = Math.abs(particleDistance - rippleRadius);
            if (distanceFromRipple < 30) {
              const rippleEffect = 1 - (distanceFromRipple / 30);
              rippleScale += rippleEffect * 0.4; // Expand by up to 40%
            }
          });
          
          // Calculate orbital path with chaos (no lean - keep natural motion)
          // Use particle's original position as the orbit path base
          const baseAngle = Math.atan2(particle.y, particle.x);
          
          // Maintain elliptical orbits - use original x and y magnitudes
          const baseX = particle.x;
          const baseY = particle.y;
          
          // Create chaotic orbital motion maintaining elliptical shape
          const orbitX1 = Math.cos(baseAngle) * Math.abs(baseX);
          const orbitY1 = Math.sin(baseAngle) * Math.abs(baseY);
          const orbitX2 = Math.cos(baseAngle + Math.PI / 3) * (Math.abs(baseX) + 20);
          const orbitY2 = Math.sin(baseAngle + Math.PI / 3) * (Math.abs(baseY) + 15);
          const orbitX3 = Math.cos(baseAngle + Math.PI * 2 / 3) * (Math.abs(baseX) - 15);
          const orbitY3 = Math.sin(baseAngle + Math.PI * 2 / 3) * (Math.abs(baseY) - 10);
          const orbitX4 = Math.cos(baseAngle + Math.PI) * Math.abs(baseX);
          const orbitY4 = Math.sin(baseAngle + Math.PI) * Math.abs(baseY);
          
          const scale = (1 + particle.z / 200) * rippleScale;
          const baseOpacity = Math.max(0.3, Math.min(0.9, 0.6 + particle.z / 300));
          // Brighten when cursor is near
          const opacity = baseOpacity + proximityFactor * 0.5;
          
          // Organic pulsing unique to each particle
          const pulsePhase = particle.id * 0.37;
          // Pulse faster when cursor is near
          const speedMultiplier = Math.max(0.6, 1 - proximityFactor * 0.4);
          
          return (
            <motion.div
              key={particle.id}
              className="absolute"
              style={{
                width: particle.size,
                height: particle.size,
                left: '50%',
                top: '50%',
                filter: `blur(${particle.z < -30 ? 0.5 : 0}px)`, // Blur distant particles
              }}
              animate={{
                x: [orbitX1, orbitX2, orbitX3, orbitX4, orbitX1],
                y: [orbitY1, orbitY2, orbitY3, orbitY4, orbitY1],
                z: [particle.z, particle.z + 30, particle.z - 20, particle.z + 10, particle.z],
                scale: [scale, scale * 1.1, scale * 0.9, scale * 1.05, scale],
                rotate: [0, 90, 180, 270, 360],
              }}
              transition={{
                duration: particle.speed * speedMultiplier,
                repeat: Infinity,
                ease: 'easeInOut',
                type: 'tween',
              }}
            >
              {/* Outer living aura */}
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background: `radial-gradient(circle, ${energyColor.replace('rgb', 'rgba').replace(')', ', 0.5)')} 0%, ${energyColor.replace('rgb', 'rgba').replace(')', ', 0.3)')} 50%, transparent 100%)`,
                  filter: `blur(${3 + proximityFactor * 2}px)`,
                }}
                animate={{
                  scale: [1.8 + proximityFactor * 0.4, 2.4 + proximityFactor * 0.6, 1.8 + proximityFactor * 0.4],
                  opacity: [0.3 + proximityFactor * 0.2, 0.5 + proximityFactor * 0.3, 0.3 + proximityFactor * 0.2],
                }}
                transition={{
                  duration: syncBreathing ? 2 : (2 + pulsePhase) * speedMultiplier,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  type: 'tween',
                }}
              />
              
              {/* Core particle with breathing */}
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${energyColor} 0%, ${energyColor.replace('rgb', 'rgba').replace(')', ', 0.8)')} 100%)`,
                  opacity: opacity,
                  boxShadow: `0 0 ${8 + proximityFactor * 16}px rgba(103, 232, 249, ${0.5 + proximityFactor * 0.4})`,
                }}
                animate={{
                  scale: [1, 1.15 + proximityFactor * 0.15, 1],
                  opacity: [opacity * 0.85, opacity, opacity * 0.85],
                }}
                transition={{
                  // BREATHING SYNCHRONIZATION - use unified rhythm during sync
                  duration: syncBreathing ? 2 : (1.5 + pulsePhase * 0.5) * speedMultiplier,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  type: 'tween',
                }}
              >
                {/* Inner glow highlight */}
                <motion.div 
                  className="absolute rounded-full bg-gradient-to-br from-white/50 to-transparent"
                  style={{
                    width: '50%',
                    height: '50%',
                    top: '20%',
                    left: '20%',
                  }}
                  animate={{
                    opacity: [0.6, 0.9, 0.6],
                  }}
                  transition={{
                    duration: 1 + pulsePhase * 0.3,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    type: 'tween',
                  }}
                />
              </motion.div>
            </motion.div>
          );
        })}
        
        {/* Center core - The Eye watching the cursor */}
        <motion.div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12"
          animate={{
            x: mousePos.x * 0.35,
            y: mousePos.y * 0.35,
            // ATTENTION FOCUS - Eye dilates when cursor near center
            scale: (() => {
              const distanceFromCenter = Math.sqrt(cursorRaw.x * cursorRaw.x + cursorRaw.y * cursorRaw.y);
              const dilationFactor = Math.max(0, 1 - distanceFromCenter / 200); // Within 200px of center
              return 1 + dilationFactor * 0.5; // Dilate up to 50% bigger
            })(),
          }}
          transition={{
            type: 'spring',
            stiffness: 50,
            damping: 20,
            mass: 0.8,
          }}
          style={{ zIndex: 10 }}
        >
          {/* Outer consciousness field */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(103, 232, 249, 0.25) 0%, rgba(59, 130, 246, 0.1) 60%, transparent 100%)',
              filter: 'blur(8px)',
            }}
            animate={{
              scale: [2.5, 3.2, 2.5],
              opacity: [0.4, 0.6, 0.4],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: 'easeInOut',
              type: 'tween',
            }}
          />
          
          {/* Main core with organic morphing */}
          <motion.div
            className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400"
            animate={{
              scale: [1, 1.15, 0.95, 1.2, 1.05, 1],
              borderRadius: ['50%', '42% 58% 45% 55%', '55% 45% 58% 42%', '45% 55% 42% 58%', '58% 42% 55% 45%', '50%'],
            }}
            transition={{
              duration: 3.5,
              repeat: Infinity,
              ease: 'easeInOut',
              type: 'tween',
            }}
            style={{
              boxShadow: '0 0 30px rgba(59, 130, 246, 0.6), 0 0 60px rgba(59, 130, 246, 0.4)',
            }}
          />
          
          {/* Corona layer - breathing */}
          <motion.div
            className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-400/40 to-cyan-300/40 blur-md"
            animate={{
              scale: [1.6, 2.0, 1.6],
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: 'easeInOut',
              type: 'tween',
            }}
          />
          
          {/* The Eye - tracks cursor */}
          <motion.div
            className="absolute rounded-full"
            style={{
              width: '35%',
              height: '35%',
              background: 'radial-gradient(circle, rgba(255, 255, 255, 0.95) 0%, rgba(103, 232, 249, 0.6) 100%)',
              boxShadow: '0 0 15px rgba(255, 255, 255, 0.8)',
            }}
            animate={{
              left: [`${32.5 + mousePos.x * 0.03}%`],
              top: [`${32.5 + mousePos.y * 0.03}%`],
              scale: [1, 1.15, 0.95, 1],
            }}
            transition={{
              left: { type: 'tween' },
              top: { type: 'tween' },
              scale: { duration: 2, repeat: Infinity, ease: 'easeInOut', type: 'tween' },
            }}
          />
          
          {/* Inner energy core */}
          <motion.div
            className="absolute inset-2 rounded-full bg-gradient-to-br from-cyan-200 to-blue-400"
            animate={{
              scale: [0.7, 1.0, 0.6, 0.9, 0.7],
              opacity: [0.6, 0.9, 0.5, 0.8, 0.6],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: 'easeInOut',
              type: 'tween',
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}
