;; Configuration is read with typed Config values and defaults, a missing
;; required value fails with ConfigError, and progress is logged.

(type ServerSettings {:host String
 :port Int
 :debug Bool
 :ratio Number})

(error Misconfigured {:reason String})

(: settings (Effect ServerSettings [ConfigError] []))
(define settings (do! [host (config String "HOST")
        port (config Int "PORT" :default 8080)
        debug (config Bool "DEBUG" :default false)
        ratio (config Number "SAMPLE_RATIO" :default 0.5)
        _ (log "loaded settings for" host)]
    (succeed {:host host :port port :debug debug :ratio ratio})))

(: validated-settings (Effect ServerSettings [Misconfigured] []))
(define validated-settings (do! [loaded (catch settings
                 (ConfigError _) (fail (Misconfigured {:reason "HOST is required"})))]
    (if (and (> (get loaded :port) 0) (< (get loaded :port) 65536))
      (succeed loaded)
      (fail (Misconfigured {:reason (str "port " (get loaded :port) " is out of range")})))))

(: base-url (Effect String [Misconfigured] []))
(define base-url (do! [current validated-settings]
    (succeed (str (if (get current :debug) "http" "https") "://" (get current :host) ":" (get current :port)))))
