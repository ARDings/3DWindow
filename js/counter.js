/**
 * Visitor Counter - PHP Backend Version
 * 
 * Nutzt eigenes PHP-Backend statt externem Service.
 * Counter-Daten werden auf dem Server in counter_data.txt gespeichert.
 * 
 * WICHTIG: Folgende Dateien NIEMALS löschen:
 * - /api/counter.php (das Script)
 * - /api/counter_data.txt (die Daten - wird automatisch erstellt)
 */

const CounterConfig = {
    // API-Endpunkt - absolute URL da wir wissen dass sie funktioniert
    apiUrl: 'https://bestarcadegame.com/api/counter.php',
    
    // Session-Key um Mehrfachzählung zu verhindern
    sessionKey: 'xrchris_counted',
    
    // Fallback-Wert wenn API nicht erreichbar (z.B. lokal)
    fallbackCount: 10420
};

/**
 * Zählt den Besuch und holt den aktuellen Stand
 */
async function fetchCount(shouldHit = false) {
    const url = shouldHit 
        ? `${CounterConfig.apiUrl}?hit=1` 
        : CounterConfig.apiUrl;
    
    try {
        console.log('Counter: Fetching from', url);
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Counter: Got response', data);
        
        if (data.success) {
            return data.count;
        } else {
            throw new Error('API returned error');
        }
    } catch (error) {
        console.error('Counter: API error -', error.message);
        return null;
    }
}

/**
 * Zeigt die Zahl im Counter an
 */
function updateCounterDisplay(count) {
    // Suche nach dem Counter-Element (verschiedene mögliche IDs/Klassen)
    const numberContainer = document.getElementById('visitor-count') 
        || document.querySelector('.visitor-counter__number')
        || document.querySelector('.counter-number');
    
    if (!numberContainer) {
        console.error('Counter: Number container not found!');
        return;
    }
    
    // Zahl formatieren (z.B. 10.420)
    const formattedCount = count.toLocaleString('de-DE');
    
    // Loading-Klasse entfernen falls vorhanden
    numberContainer.classList.remove('loading');
    
    // Zahl anzeigen
    numberContainer.textContent = formattedCount;
    console.log('Counter: Display updated to', formattedCount);
}

/**
 * Initialisiert den Counter
 */
async function initCounter() {
    // Suche nach Counter-Element (verschiedene Selektoren)
    const counter = document.getElementById('visitor-counter') 
        || document.querySelector('.visitor-counter');
    
    if (!counter) {
        console.warn('Counter: Container element not found');
        return;
    }
    
    console.log('Counter: Initializing...');
    
    // Prüfen ob in dieser Session schon gezählt wurde
    const alreadyCounted = sessionStorage.getItem(CounterConfig.sessionKey);
    
    // Counter abrufen (mit hit wenn noch nicht gezählt)
    const count = await fetchCount(!alreadyCounted);
    
    if (count !== null) {
        updateCounterDisplay(count);
        
        // Session markieren
        if (!alreadyCounted) {
            sessionStorage.setItem(CounterConfig.sessionKey, 'true');
        }
    } else {
        // Fallback bei Fehler (zeigt Basis-Wert, funktioniert auch lokal)
        console.warn('Counter API not available - showing fallback');
        updateCounterDisplay(CounterConfig.fallbackCount);
    }
}

// Beim Laden starten
document.addEventListener('DOMContentLoaded', initCounter);
