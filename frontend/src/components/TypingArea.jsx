import React from 'react';

export function TypingArea({
  targetText = '',
  placeholder = 'Type here...',
  label = '',
  isPassword = false,
  captureHook,
  disabled = false
}) {
  const {
    typedText,
    metrics,
    handleKeyDown,
    handleKeyUp,
    handleChange,
    reset
  } = captureHook;

  // Renders the fixed sentence with visual highlighting based on input matching
  const renderHighlightedSentence = () => {
    if (!targetText) return null;

    return (
      <div className="target-sentence">
        {targetText.split('').map((char, index) => {
          let className = 'char-untyped';
          if (index < typedText.length) {
            className = typedText[index] === char ? 'char-correct' : 'char-incorrect';
          } else if (index === typedText.length) {
            className = 'char-current';
          }
          return (
            <span key={index} className={className}>
              {char}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className="typing-area-container">
      {label && <label className="field-label">{label}</label>}
      
      {renderHighlightedSentence()}

      <div className="input-wrapper">
        {isPassword ? (
          /* SECURITY: Password input is UNCONTROLLED — React never binds or reads its value.
           * The browser handles native masking (••••). Keystroke timing events are captured
           * via onKeyDown/onKeyUp but the actual characters never enter React state or props.
           * This means the password is completely invisible in Chrome DevTools. */
          <input
            type="password"
            className={`typing-input password-field ${metrics ? 'typing-active' : ''}`}
            placeholder={placeholder}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onChange={handleChange}
            disabled={disabled}
            autoComplete="new-password"
            data-lpignore="true"
          />
        ) : (
          <input
            type="text"
            className={`typing-input ${metrics ? 'typing-active' : ''}`}
            placeholder={placeholder}
            value={typedText}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onChange={handleChange}
            disabled={disabled}
            autoComplete="off"
          />
        )}
        {typedText && (
          <button type="button" className="clear-btn" onClick={reset} disabled={disabled} title="Clear text">
            ✕
          </button>
        )}
      </div>

      {metrics && (
        <div className="realtime-metrics">
          <div className="metric-badge">
            <span className="metric-label">Hold</span>
            <span className="metric-val">{metrics.averageHoldTime} ms</span>
          </div>
          <div className="metric-badge">
            <span className="metric-label">Flight</span>
            <span className="metric-val">{metrics.averageFlightTime} ms</span>
          </div>
          {!isPassword && (
            <>
              <div className="metric-badge">
                <span className="metric-label">Speed</span>
                <span className="metric-val">{metrics.typingSpeed} WPM</span>
              </div>
              <div className="metric-badge">
                <span className="metric-label">Errors</span>
                <span className="metric-val">{metrics.errorCount}</span>
              </div>
            </>
          )}
          <div className="metric-badge">
            <span className="metric-label">Backspaces</span>
            <span className="metric-val">{metrics.backspaceCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default TypingArea;
