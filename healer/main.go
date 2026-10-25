package main

import (
	"log"
	"net/http"
	"os/exec"
	"sync"
	"time"
)

// monitorService continuously checks the given URL and restarts the docker container on failure.
func monitorService(name string, url string, wg *sync.WaitGroup) {
	defer wg.Done()

	cooldown := 5 * time.Second
	lastRestart := time.Time{}
	client := http.Client{
		Timeout: 500 * time.Millisecond,
	}

	for {
		time.Sleep(1 * time.Second)

		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				// Record recovery immediately once healthy
				if !lastRestart.IsZero() {
					recoveryTime := time.Since(lastRestart).Seconds()
					log.Printf("RECOVERED: %s (%.1fs)", name, recoveryTime)
					lastRestart = time.Time{} // Reset recovered state
				}
				continue
			}
		}

		// Prevent duplicate restart storm while container is rebooting during cooldown
		if !lastRestart.IsZero() && time.Since(lastRestart) < cooldown {
			continue
		}

		log.Printf("FAILURE DETECTED: %s", name)
		log.Printf("RESTARTING: %s", name)
		lastRestart = time.Now()

		cmd := exec.Command("docker", "restart", name)
		err = cmd.Run()
		if err != nil {
			log.Printf("Failed to restart %s: %v", name, err)
		}
	}
}

func main() {
	var wg sync.WaitGroup
	services := map[string]string{
		"api1": "http://api1:3000/health",
		"api2": "http://api2:3000/health",
		"api3": "http://api3:3000/health",
	}

	for name, url := range services {
		wg.Add(1)
		go monitorService(name, url, &wg)
	}

	log.Println("Self-healing system started, monitoring services...")
	wg.Wait()
}
