// Package amp implements the Amp agent adapter: launching new interactive Amp
// sessions and resuming sessions when a native Amp thread id is known.
//
// Amp activity hooks and SessionInfo derivation will likely require an
// Amp-specific TypeScript plugin, similar to opencode. Until that integration
// exists, hook installation and SessionInfo are intentionally no-ops.
package amp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/aoagents/agent-orchestrator/backend/internal/adapters"
	"github.com/aoagents/agent-orchestrator/backend/internal/ports"
)

const adapterID = "amp"

// Plugin is the Amp agent adapter. It is safe for concurrent use; the binary
// path is resolved once and cached under binaryMu.
type Plugin struct {
	binaryMu       sync.Mutex
	resolvedBinary string
}

// New returns a ready-to-register Amp adapter.
func New() *Plugin {
	return &Plugin{}
}

var _ adapters.Adapter = (*Plugin)(nil)
var _ ports.Agent = (*Plugin)(nil)

// Manifest returns the adapter's static self-description.
func (p *Plugin) Manifest() adapters.Manifest {
	return adapters.Manifest{
		ID:          adapterID,
		Name:        "Amp",
		Description: "Run Amp worker sessions.",
		Version:     "0.0.1",
		Capabilities: []adapters.Capability{
			adapters.CapabilityAgent,
		},
	}
}

// GetConfigSpec reports no agent-specific config keys yet.
func (p *Plugin) GetConfigSpec(ctx context.Context) (ports.ConfigSpec, error) {
	if err := ctx.Err(); err != nil {
		return ports.ConfigSpec{}, err
	}
	return ports.ConfigSpec{}, nil
}

// GetLaunchCommand builds the argv to start a new Amp session:
//
//	amp [-x <prompt>]
//
// Amp's current CLI has no documented per-run permission or system-prompt flag.
// When AO has an initial prompt, it is sent through execute mode (`-x`), whose
// next argv element is the prompt text so a leading "-" is not parsed as a flag.
func (p *Plugin) GetLaunchCommand(ctx context.Context, cfg ports.LaunchConfig) (cmd []string, err error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	binary, err := p.ampBinary(ctx)
	if err != nil {
		return nil, err
	}

	cmd = []string{binary}
	if cfg.Prompt != "" {
		cmd = append(cmd, "-x", cfg.Prompt)
	}
	return cmd, nil
}

// GetPromptDeliveryStrategy reports that Amp receives its prompt in the launch
// command itself.
func (p *Plugin) GetPromptDeliveryStrategy(ctx context.Context, cfg ports.LaunchConfig) (ports.PromptDeliveryStrategy, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return ports.PromptDeliveryInCommand, nil
}

// GetAgentHooks is intentionally a no-op until Amp activity can be reported via
// an Amp-specific plugin.
func (p *Plugin) GetAgentHooks(ctx context.Context, cfg ports.WorkspaceHookConfig) error {
	return ctx.Err()
}

// GetRestoreCommand rebuilds the argv that continues an existing Amp session
// when plugin-derived native session metadata is available. Until that metadata
// exists, ok is false and callers fall back to fresh launch behavior.
func (p *Plugin) GetRestoreCommand(ctx context.Context, cfg ports.RestoreConfig) (cmd []string, ok bool, err error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	agentSessionID := strings.TrimSpace(cfg.Session.Metadata[ports.MetadataKeyAgentSessionID])
	if agentSessionID == "" {
		return nil, false, nil
	}

	binary, err := p.ampBinary(ctx)
	if err != nil {
		return nil, false, err
	}
	cmd = []string{binary, "threads", "continue", agentSessionID}
	return cmd, true, nil
}

// SessionInfo is intentionally a no-op until Amp plugin metadata exists.
func (p *Plugin) SessionInfo(ctx context.Context, session ports.SessionRef) (ports.SessionInfo, bool, error) {
	if err := ctx.Err(); err != nil {
		return ports.SessionInfo{}, false, err
	}
	return ports.SessionInfo{}, false, nil
}

// ResolveAmpBinary finds the `amp` binary, searching PATH then common install
// locations. It returns "amp" as a last resort so callers get the shell's normal
// command-not-found behavior if Amp is absent.
func ResolveAmpBinary(ctx context.Context) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}

	if runtime.GOOS == "windows" {
		for _, name := range []string{"amp.cmd", "amp.exe", "amp"} {
			if path, err := exec.LookPath(name); err == nil && path != "" {
				return path, nil
			}
			if err := ctx.Err(); err != nil {
				return "", err
			}
		}
		candidates := []string{}
		if appData := os.Getenv("APPDATA"); appData != "" {
			candidates = append(candidates,
				filepath.Join(appData, "npm", "amp.cmd"),
				filepath.Join(appData, "npm", "amp.exe"),
			)
		}
		for _, candidate := range candidates {
			if fileExists(candidate) {
				return candidate, nil
			}
			if err := ctx.Err(); err != nil {
				return "", err
			}
		}
		return "", fmt.Errorf("amp: %w", ports.ErrAgentBinaryNotFound)
	}

	if path, err := exec.LookPath("amp"); err == nil && path != "" {
		return path, nil
	}

	candidates := []string{
		"/usr/local/bin/amp",
		"/opt/homebrew/bin/amp",
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin", "amp"),
			filepath.Join(home, ".npm", "bin", "amp"),
		)
	}

	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate, nil
		}
		if err := ctx.Err(); err != nil {
			return "", err
		}
	}

	return "", fmt.Errorf("amp: %w", ports.ErrAgentBinaryNotFound)
}

func (p *Plugin) ampBinary(ctx context.Context) (string, error) {
	p.binaryMu.Lock()
	defer p.binaryMu.Unlock()

	if p.resolvedBinary != "" {
		return p.resolvedBinary, nil
	}

	binary, err := ResolveAmpBinary(ctx)
	if err != nil {
		return "", err
	}
	p.resolvedBinary = binary
	return binary, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
