import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CarFront, CircleHelp, Expand, MapPin, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { KhulnaGame, type GameStatus } from './game/KhulnaGame'

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<KhulnaGame | null>(null)
  const [status, setStatus] = useState<GameStatus>('loading')
  const [message, setMessage] = useState('Preparing the city...')
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(0)
  const [showHelp, setShowHelp] = useState(false)
  const [mapSource, setMapSource] = useState<'loading' | 'osm' | 'fallback'>('loading')

  useEffect(() => {
    if (!canvasRef.current) return
    const game = new KhulnaGame(canvasRef.current, {
      onStatus: setStatus,
      onMessage: setMessage,
      onSpeed: setSpeed,
      onMapSource: setMapSource,
    })
    gameRef.current = game
    void game.start()
    return () => {
      game.destroy()
      gameRef.current = null
    }
  }, [])

  const startGame = useCallback(() => {
    gameRef.current?.resume()
    setPaused(false)
  }, [])

  const togglePause = useCallback(() => {
    if (paused) {
      gameRef.current?.resume()
      setPaused(false)
    } else {
      gameRef.current?.pause()
      setPaused(true)
    }
  }, [paused])

  const toggleFullscreen = useCallback(async () => {
    const host = document.querySelector('.game-shell')
    if (!host) return
    try {
      if (!document.fullscreenElement) await host.requestFullscreen()
      else await document.exitFullscreen()
    } catch {
      setMessage('Fullscreen is not available in this browser.')
    }
  }, [])

  const setTouch = (key: string, down: boolean) => gameRef.current?.setTouchKey(key, down)

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Khulna City home">
          <span className="brand-mark">KC</span>
          <span className="brand-copy"><strong>KHULNA CITY</strong><small>OPEN WORLD PROJECT</small></span>
        </a>
        <div className="topbar-right">
          <span className="live-dot" /> <span className="topbar-label">BROWSER GAME PROTOTYPE</span>
          <button className="icon-button" onClick={() => setShowHelp(v => !v)} aria-label="Show controls"><CircleHelp size={18} /></button>
        </div>
      </header>

      <section className="intro" id="home">
        <div className="intro-copy">
          <div className="eyebrow"><MapPin size={14} /> KHULNA, BANGLADESH</div>
          <h1>Your city.<br /><span>Your open world.</span></h1>
          <p>Explore a browser-based 3D city prototype inspired by Khulna. Explore the Sonadanga-side district around Khulna City Medical College and Banorgati, with mapped roads, building footprints, named landmarks and a first drivable car prototype.</p>
          <div className="intro-actions">
            <button className="primary-button" onClick={startGame}><Play size={16} fill="currentColor" /> {paused ? 'RESUME GAME' : 'ENTER THE CITY'} <ArrowUpRight size={16} /></button>
            <button className="secondary-button" onClick={toggleFullscreen}><Expand size={16} /> FULLSCREEN</button>
          </div>
          <div className="status-line"><span className={status === 'ready' ? 'status-dot ready' : 'status-dot'} /> {status === 'ready' ? 'GAME WORLD READY' : status === 'loading' ? 'LOADING CITY WORLD' : status === 'error' ? 'RENDERER ERROR' : 'GAME PAUSED'}</div>
        </div>
        <div className="intro-stat">
          <span className="stat-label">CURRENT BUILD</span>
          <strong>0.6 <span>ALPHA</span></strong>
          <div className="stat-divider" />
          <span className="stat-label">MAP DATA</span>
          <strong className="map-stat">{mapSource === 'osm' ? 'OPENSTREETMAP' : mapSource === 'fallback' ? 'LOCAL PROTOTYPE' : 'LOADING…'}</strong>
          <small>{mapSource === 'osm' ? 'Expanded map with available landmark labels loaded' : mapSource === 'fallback' ? 'OSM unavailable; using prototype map' : 'Requesting geographic data'}</small>
        </div>
      </section>

      <section className="game-section" aria-label="Playable 3D game">
        <div className="game-heading">
          <div><span className="section-kicker">LIVE WORLD</span><h2>Explore Khulna</h2></div>
          <div className="game-tools">
            <span className="chip"><span className="tiny-dot" /> 3D RENDER</span>
            <button className="icon-button" onClick={() => setMuted(v => !v)} aria-label={muted ? 'Enable sound' : 'Mute sound'}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
            <button className="icon-button" onClick={toggleFullscreen} aria-label="Toggle fullscreen"><Expand size={17} /></button>
            <button className="icon-button" onClick={togglePause} aria-label={paused ? 'Resume game' : 'Pause game'}>{paused ? <Play size={17} /> : <Pause size={17} />}</button>
          </div>
        </div>

        <div className="game-shell">
          <canvas ref={canvasRef} className="game-canvas" aria-label="Interactive 3D Khulna city game" />
          <div className="game-vignette" />
          <div className="game-top-hud">
            <div className="location-pill"><MapPin size={13} /><span>KHULNA DISTRICT</span><i /></div>
            <div className="build-pill">ALPHA 0.6</div>
          </div>
          <div className="crosshair" />
          <div className="game-bottom-hud">
            <div className="player-card"><div className="avatar">KC</div><div><strong>PLAYER 01</strong><small>FREE ROAM</small></div></div>
            <div className="speed-card"><CarFront size={16} /><strong>{Math.round(speed)} <small>KM/H</small></strong></div>
          </div>
          {status === 'loading' && <div className="game-overlay"><div className="loader" /><strong>BUILDING THE CITY</strong><p>{message}</p></div>}
          {status === 'error' && <div className="game-overlay"><strong>3D VIEW UNAVAILABLE</strong><p>{message}</p><button className="secondary-button" onClick={() => window.location.reload()}><RotateCcw size={15} /> Reload game</button></div>}
          {paused && status === 'ready' && <div className="pause-overlay"><div className="pause-card"><span className="section-kicker">GAME PAUSED</span><h3>Take a breath.</h3><p>Your city is waiting.</p><button className="primary-button" onClick={startGame}><Play size={15} fill="currentColor" /> RESUME</button></div></div>}
          {showHelp && <div className="help-panel"><button className="help-close" onClick={() => setShowHelp(false)}>×</button><strong>HOW TO PLAY</strong><p><b>W A S D</b> Move · <b>Mouse</b> Look · <b>Shift</b> Sprint · <b>Space</b> Jump · <b>V</b> Enter/exit car · <b>Esc</b> Pause</p><p>Near the parked car, press V or tap DRIVE. In car: W/S accelerate or reverse; A/D steer; Space brake. Wheels animate and front wheels turn. Mobile players can use the direction pad and DRIVE button.</p></div>}
          <div className="desktop-hint"><span>W A S D</span> TO MOVE <i /> <span>MOUSE</span> TO LOOK</div>
          <div className="touch-controls">
            <div className="touch-pad" onContextMenu={e => e.preventDefault()}>
              <button aria-label="Move forward" onPointerDown={() => setTouch('KeyW', true)} onPointerUp={() => setTouch('KeyW', false)} onPointerLeave={() => setTouch('KeyW', false)}>▲</button>
              <div><button aria-label="Move left" onPointerDown={() => setTouch('KeyA', true)} onPointerUp={() => setTouch('KeyA', false)} onPointerLeave={() => setTouch('KeyA', false)}>◀</button><button aria-label="Move backward" onPointerDown={() => setTouch('KeyS', true)} onPointerUp={() => setTouch('KeyS', false)} onPointerLeave={() => setTouch('KeyS', false)}>▼</button><button aria-label="Move right" onPointerDown={() => setTouch('KeyD', true)} onPointerUp={() => setTouch('KeyD', false)} onPointerLeave={() => setTouch('KeyD', false)}>▶</button></div>
            </div>
            <div className="touch-actions"><button onPointerDown={() => setTouch('ShiftLeft', true)} onPointerUp={() => setTouch('ShiftLeft', false)} onPointerLeave={() => setTouch('ShiftLeft', false)}>RUN</button><button onPointerDown={() => setTouch('Space', true)} onPointerUp={() => setTouch('Space', false)} onPointerLeave={() => setTouch('Space', false)}>JUMP</button><button onClick={() => setTouch('KeyV', true)}>DRIVE</button></div>
          </div>
        </div>
        <div className="game-caption"><span><i /> {mapSource === 'osm' ? 'REAL GEOGRAPHIC DATA LOADED' : 'EARLY PLAYABLE BUILD'}</span><span>MAP CACHE SAVED LOCALLY WHEN AVAILABLE</span></div>
      </section>

      <section className="feature-row">
        <article><span className="feature-number">01 / WORLD</span><h3>Built around the real city</h3><p>Start with mapped roads and building footprints around central Khulna, then expand district by district.</p></article>
        <article><span className="feature-number">02 / GAMEPLAY</span><h3>A world you can move through</h3><p>Third-person movement, camera control, collision and mobile-friendly inputs form the first playable foundation.</p></article>
        <article><span className="feature-number">03 / NEXT</span><h3>More city, more systems</h3><p>Vehicles, pedestrians, missions, detailed assets and additional neighborhoods will be added in later phases.</p></article>
      </section>

      <footer className="footer"><a className="brand footer-brand" href="#home"><span className="brand-mark">KC</span><span className="brand-copy"><strong>KHULNA CITY</strong><small>OPEN WORLD PROJECT</small></span></a><p>Independent browser-game prototype. Not affiliated with any city authority. Map data, when loaded: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>.</p><span>BUILT FOR THE WEB · 2026</span></footer>
      <div className="sound-state" aria-live="polite">{muted ? 'Sound muted' : ''}</div>
    </main>
  )
}
