/**
 * Circuit Breaker Pattern Implementation
 * 
 * Previene cascadas de fallos al detectar cuando un servicio está fallando
 * y temporalmente "abre" el circuito para evitar más llamadas fallidas.
 * 
 * Estados:
 * - CLOSED: Funcionamiento normal, permite todas las operaciones
 * - OPEN: Circuito abierto, rechaza operaciones inmediatamente
 * - HALF_OPEN: Permite operaciones limitadas para probar recuperación
 */

import logService from './logService.js';

const logInfo = (message, data) => logService.info(message, data);
const logError = (message, data) => logService.error(message, data);
const logWarning = (message, data) => logService.warn(message, data);

class CircuitBreaker {
    constructor(options = {}) {
        this.config = {
            failureThreshold: options.failureThreshold || 5, // Número de fallos para abrir circuito
            timeout: options.timeout || 60000, // Tiempo en OPEN antes de intentar HALF_OPEN (ms)
            monitoringPeriod: options.monitoringPeriod || 30000, // Período de monitoreo para resetear contadores
            halfOpenMaxCalls: options.halfOpenMaxCalls || 3, // Máximo llamadas en HALF_OPEN
            ...options
        };

        // Estados posibles: 'CLOSED', 'OPEN', 'HALF_OPEN'
        this.state = 'CLOSED';
        
        // Contadores y timestamps
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.lastSuccessTime = null;
        this.nextAttemptTime = null;
        this.halfOpenCallCount = 0;
        
        // Estadísticas
        this.stats = {
            totalCalls: 0,
            totalFailures: 0,
            totalSuccesses: 0,
            circuitOpenings: 0,
            lastStateChange: Date.now()
        };

        // Resetear contadores periódicamente
        this.startMonitoringPeriod();

        logInfo('Circuit Breaker initialized', { 
            state: this.state, 
            config: this.config 
        });
    }

    /**
     * Ejecuta una operación a través del circuit breaker
     */
    async execute(operation, fallback = null) {
        this.stats.totalCalls++;

        // Verificar estado del circuito
        if (this.state === 'OPEN') {
            if (this.shouldAttemptReset()) {
                this.transitionToHalfOpen();
            } else {
                const error = new Error('Circuit breaker is OPEN');
                error.code = 'CIRCUIT_BREAKER_OPEN';
                
                if (fallback && typeof fallback === 'function') {
                    logWarning('Circuit breaker OPEN, executing fallback');
                    return await fallback();
                }
                
                throw error;
            }
        }

        if (this.state === 'HALF_OPEN') {
            if (this.halfOpenCallCount >= this.config.halfOpenMaxCalls) {
                const error = new Error('Circuit breaker HALF_OPEN call limit exceeded');
                error.code = 'CIRCUIT_BREAKER_HALF_OPEN_LIMIT';
                throw error;
            }
            this.halfOpenCallCount++;
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure(error);
            throw error;
        }
    }

    /**
     * Maneja una operación exitosa
     */
    onSuccess() {
        this.successCount++;
        this.stats.totalSuccesses++;
        this.lastSuccessTime = Date.now();

        if (this.state === 'HALF_OPEN') {
            // En HALF_OPEN, si tenemos suficientes éxitos, cerrar el circuito
            if (this.successCount >= Math.ceil(this.config.halfOpenMaxCalls / 2)) {
                this.transitionToClosed();
            }
        } else if (this.state === 'CLOSED') {
            // En CLOSED, resetear contador de fallos después de un éxito
            this.failureCount = Math.max(0, this.failureCount - 1);
        }

        logInfo('Circuit breaker operation succeeded', {
            state: this.state,
            successCount: this.successCount,
            failureCount: this.failureCount
        });
    }

    /**
     * Maneja una operación fallida
     */
    onFailure(error) {
        this.failureCount++;
        this.stats.totalFailures++;
        this.lastFailureTime = Date.now();

        logError('Circuit breaker operation failed', {
            state: this.state,
            failureCount: this.failureCount,
            threshold: this.config.failureThreshold,
            error: error.message
        });

        if (this.state === 'CLOSED' || this.state === 'HALF_OPEN') {
            if (this.failureCount >= this.config.failureThreshold) {
                this.transitionToOpen();
            }
        }
    }

    /**
     * Transición a estado OPEN
     */
    transitionToOpen() {
        this.state = 'OPEN';
        this.nextAttemptTime = Date.now() + this.config.timeout;
        this.stats.circuitOpenings++;
        this.stats.lastStateChange = Date.now();

        logWarning('Circuit breaker opened', {
            failureCount: this.failureCount,
            nextAttemptTime: new Date(this.nextAttemptTime).toISOString()
        });

        // Emitir evento si hay listeners
        this.emit('stateChange', {
            from: 'CLOSED',
            to: 'OPEN',
            reason: 'Failure threshold exceeded',
            failureCount: this.failureCount
        });
    }

    /**
     * Transición a estado HALF_OPEN
     */
    transitionToHalfOpen() {
        this.state = 'HALF_OPEN';
        this.halfOpenCallCount = 0;
        this.successCount = 0;
        this.failureCount = 0;
        this.stats.lastStateChange = Date.now();

        logInfo('Circuit breaker transitioned to HALF_OPEN');

        this.emit('stateChange', {
            from: 'OPEN',
            to: 'HALF_OPEN',
            reason: 'Timeout period elapsed'
        });
    }

    /**
     * Transición a estado CLOSED
     */
    transitionToClosed() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.halfOpenCallCount = 0;
        this.nextAttemptTime = null;
        this.stats.lastStateChange = Date.now();

        logInfo('Circuit breaker closed - service recovered');

        this.emit('stateChange', {
            from: 'HALF_OPEN',
            to: 'CLOSED',
            reason: 'Service recovered'
        });
    }

    /**
     * Verifica si se debe intentar resetear el circuito
     */
    shouldAttemptReset() {
        return this.nextAttemptTime && Date.now() >= this.nextAttemptTime;
    }

    /**
     * Inicia el período de monitoreo para resetear contadores
     */
    startMonitoringPeriod() {
        setInterval(() => {
            if (this.state === 'CLOSED') {
                // Resetear contadores gradualmente en estado CLOSED
                this.failureCount = Math.max(0, this.failureCount - 1);
                this.successCount = Math.max(0, this.successCount - 1);
            }
        }, this.config.monitoringPeriod);
    }

    /**
     * Fuerza la apertura del circuito (para testing o emergencias)
     */
    forceOpen(reason = 'Manually forced') {
        const previousState = this.state;
        this.transitionToOpen();
        
        logWarning('Circuit breaker force opened', { reason, previousState });
        
        this.emit('stateChange', {
            from: previousState,
            to: 'OPEN',
            reason: `Force opened: ${reason}`
        });
    }

    /**
     * Fuerza el cierre del circuito (para testing o recuperación manual)
     */
    forceClose(reason = 'Manually forced') {
        const previousState = this.state;
        this.transitionToClosed();
        
        logInfo('Circuit breaker force closed', { reason, previousState });
        
        this.emit('stateChange', {
            from: previousState,
            to: 'CLOSED',
            reason: `Force closed: ${reason}`
        });
    }

    /**
     * Obtiene el estado actual del circuit breaker
     */
    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            halfOpenCallCount: this.halfOpenCallCount,
            nextAttemptTime: this.nextAttemptTime,
            lastFailureTime: this.lastFailureTime,
            lastSuccessTime: this.lastSuccessTime,
            stats: { ...this.stats },
            config: { ...this.config }
        };
    }

    /**
     * Obtiene métricas de rendimiento
     */
    getMetrics() {
        const now = Date.now();
        const uptime = now - (this.stats.lastStateChange || now);
        
        return {
            state: this.state,
            uptime,
            totalCalls: this.stats.totalCalls,
            totalFailures: this.stats.totalFailures,
            totalSuccesses: this.stats.totalSuccesses,
            failureRate: this.stats.totalCalls > 0 ? this.stats.totalFailures / this.stats.totalCalls : 0,
            successRate: this.stats.totalCalls > 0 ? this.stats.totalSuccesses / this.stats.totalCalls : 0,
            circuitOpenings: this.stats.circuitOpenings,
            currentFailureCount: this.failureCount,
            isHealthy: this.state === 'CLOSED' && this.failureCount < this.config.failureThreshold / 2
        };
    }

    /**
     * Resetea todas las estadísticas
     */
    reset() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.halfOpenCallCount = 0;
        this.lastFailureTime = null;
        this.lastSuccessTime = null;
        this.nextAttemptTime = null;
        
        this.stats = {
            totalCalls: 0,
            totalFailures: 0,
            totalSuccesses: 0,
            circuitOpenings: 0,
            lastStateChange: Date.now()
        };

        logInfo('Circuit breaker reset');
    }

    /**
     * Implementación básica de EventEmitter para eventos
     */
    emit(event, data) {
        if (this.listeners && this.listeners[event]) {
            this.listeners[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    logError('Error in circuit breaker event listener', { event, error: error.message });
                }
            });
        }
    }

    /**
     * Registra un listener para eventos
     */
    on(event, callback) {
        if (!this.listeners) {
            this.listeners = {};
        }
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    /**
     * Remueve un listener
     */
    off(event, callback) {
        if (this.listeners && this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }
}

export default CircuitBreaker;