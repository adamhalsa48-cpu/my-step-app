import { Capacitor } from '@capacitor/core'

type StopTracking = () => Promise<void>
type MotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>
}

export async function startStepTracking(onStepCount: (steps: number) => void, currentSteps: number): Promise<StopTracking> {
  if (Capacitor.isNativePlatform()) {
    const { CapacitorPedometer } = await import('@capgo/capacitor-pedometer')
    const available = await CapacitorPedometer.isAvailable()
    if (!available.stepCounting) throw new Error('Step counting is not supported on this device.')

    let baseSteps = currentSteps
    if (Capacitor.getPlatform() === 'ios') {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const history = await CapacitorPedometer.getMeasurement({ start: start.getTime(), end: Date.now() })
      baseSteps = Math.max(baseSteps, history.numberOfSteps ?? 0)
      onStepCount(baseSteps)
    }

    const permission = await CapacitorPedometer.checkPermissions()
    if (permission.activityRecognition !== 'granted') {
      const requested = await CapacitorPedometer.requestPermissions()
      if (requested.activityRecognition !== 'granted') throw new Error('Allow motion access in device settings to sync your steps.')
    }

    let lastCount = 0
    const listener = await CapacitorPedometer.addListener('measurement', (measurement) => {
      const count = Math.max(0, Math.floor(measurement.numberOfSteps ?? 0))
      lastCount = Math.max(lastCount, count)
      onStepCount(Math.min(200000, baseSteps + lastCount))
    })
    try {
      await CapacitorPedometer.startMeasurementUpdates()
    } catch (error) {
      await listener.remove()
      throw error
    }
    return async () => {
      await listener.remove()
      await CapacitorPedometer.stopMeasurementUpdates()
    }
  }

  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
    throw new Error('Motion sensing is unavailable here. Use the manual step buttons instead.')
  }

  const MotionEvent = window.DeviceMotionEvent as MotionEventWithPermission
  if (typeof MotionEvent.requestPermission === 'function') {
    const permission = await MotionEvent.requestPermission()
    if (permission !== 'granted') throw new Error('Allow motion access in your browser settings to count steps.')
  }

  let previousMagnitude = 0
  let lastStepAt = 0
  let detectedSteps = 0
  const handleMotion = (event: DeviceMotionEvent) => {
    const acceleration = event.accelerationIncludingGravity
    if (!acceleration) return
    const magnitude = Math.hypot(acceleration.x ?? 0, acceleration.y ?? 0, acceleration.z ?? 0)
    const now = Date.now()
    if (previousMagnitude && Math.abs(magnitude - previousMagnitude) > 1.25 && now - lastStepAt > 300) {
      detectedSteps += 1
      lastStepAt = now
      onStepCount(Math.min(200000, currentSteps + detectedSteps))
    }
    previousMagnitude = magnitude
  }
  window.addEventListener('devicemotion', handleMotion)
  return async () => window.removeEventListener('devicemotion', handleMotion)
}
