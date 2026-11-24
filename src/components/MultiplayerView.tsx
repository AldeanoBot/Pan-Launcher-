import { useState } from 'react';
import {
  Check,
  Copy,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import type { MultiplayerServer, NetworkConfig, ServerCategory } from '../types/client';
import { SERVER_BANNER_IMG } from '../data/catalog';

interface MultiplayerViewProps {
  servers: MultiplayerServer[];
  network: NetworkConfig;
  onAddServer: (name: string, address: string, category: ServerCategory) => void;
  onRemoveServer: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateServerPing: (id: string, patch: Partial<MultiplayerServer>) => void;
  onUpdateNetwork: (patch: Partial<NetworkConfig>) => void;
  onLaunchServer: (address: string, serverName: string) => void;
}

export function MultiplayerView({
  servers,
  network,
  onAddServer,
  onRemoveServer,
  onToggleFavorite,
  onUpdateServerPing,
  onUpdateNetwork,
  onLaunchServer,
}: MultiplayerViewProps) {
  const [filter, setFilter] = useState<'all' | 'favorites' | 'pvp' | 'survival'>('all');
  const [search, setSearch] = useState('');
  const [directIp, setDirectIp] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newCategory, setNewCategory] = useState<ServerCategory>('custom');
  const [formError, setFormError] = useState('');
  const [pingingIds, setPingingIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const pingSingleServer = async (server: MultiplayerServer) => {
    setPingingIds((prev) => ({ ...prev, [server.id]: true }));
    try {
      const res = await fetch('/api/mc/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: server.address }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.online) {
          onUpdateServerPing(server.id, {
            online: true,
            latencyMs: data.latencyMs,
            playersOnline: data.playersOnline ?? server.playersOnline,
            playersMax: data.playersMax ?? server.playersMax,
            versionName: data.versionName ?? server.versionName,
            motd: data.motd || server.motd,
            lastChecked: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
          });
        } else {
          onUpdateServerPing(server.id, {
            online: false,
            latencyMs: null,
            lastChecked: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
          });
        }
      }
    } catch {
      onUpdateServerPing(server.id, { online: false, latencyMs: null });
    } finally {
      setPingingIds((prev) => ({ ...prev, [server.id]: false }));
    }
  };

  const handleRefreshAll = async () => {
    await Promise.all(servers.map((srv) => pingSingleServer(srv)));
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newAddress.trim()) {
      setFormError('Debes indicar el nombre y la IP del servidor.');
      return;
    }
    onAddServer(newName.trim(), newAddress.trim(), newCategory);
    setNewName('');
    setNewAddress('');
    setFormError('');
    setShowAddForm(false);
  };

  const handleCopyAddress = async (id: string, address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleDirectConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directIp.trim()) return;
    onLaunchServer(directIp.trim(), directIp.trim());
  };

  const filteredServers = servers.filter((srv) => {
    if (filter === 'favorites' && !srv.favorite) return false;
    if (filter === 'pvp' && srv.category !== 'pvp') return false;
    if (filter === 'survival' && srv.category !== 'survival') return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        srv.name.toLowerCase().includes(q) ||
        srv.address.toLowerCase().includes(q) ||
        srv.motd.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const featuredServer = servers.find((s) => s.featured) || servers[0];

  return (
    <div className="space-y-6">
      {/* Featured Multiplayer Server Banner */}
      {featuredServer && (
        <section className="relative rounded-xl overflow-hidden border border-[#222A35] bg-[#12161C]">
          <div className="relative min-h-[190px] flex flex-col md:flex-row md:items-end justify-between p-6 gap-5">
            <img
              src={SERVER_BANNER_IMG}
              alt={`Vista de ${featuredServer.name}`}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover opacity-45"
            />
            <div
              className="absolute inset-0 bg-gradient-to-r from-[#0B0D10] via-[#0B0D10]/80 to-[#0B0D10]/40"
              aria-hidden="true"
            />

            <div className="relative z-10 max-w-xl">
              <p className="text-xs font-medium text-emerald-400 mb-1.5">
                Servidor destacado · {featuredServer.address} · {featuredServer.versionName || '1.21.4'}
              </p>
              <h1 className="font-display text-2xl md:text-3xl font-bold text-white tracking-tight">
                {featuredServer.name}
              </h1>
              <p className="mt-1.5 text-sm text-zinc-300">{featuredServer.motd}</p>
            </div>

            <div className="relative z-10 flex flex-wrap items-center gap-3 shrink-0">
              <form onSubmit={handleDirectConnect} className="flex items-center gap-2">
                <label htmlFor="direct-connect-ip" className="sr-only">
                  Conexión directa por IP
                </label>
                <input
                  id="direct-connect-ip"
                  type="text"
                  value={directIp}
                  onChange={(e) => setDirectIp(e.target.value)}
                  placeholder="Conexión directa (IP)..."
                  className="h-10 w-48 sm:w-56 px-3 rounded-lg bg-[#0E1116]/95 border border-[#2A3442] text-sm font-mono text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                />
                <button
                  type="submit"
                  className="h-10 px-3.5 rounded-lg text-sm font-medium text-zinc-100 bg-[#1A212B] hover:bg-[#232C3A] border border-[#2E3848] whitespace-nowrap"
                >
                  Conectar
                </button>
              </form>

              <button
                type="button"
                onClick={() => onLaunchServer(featuredServer.address, featuredServer.name)}
                className="h-10 px-4 rounded-lg text-sm font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                Entrar ahora
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Toolbar: Filters, Search, Add Server & Refresh Ping */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[#12161C] rounded-lg border border-[#1E242E]">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'favorites', label: 'Favoritos' },
                { id: 'pvp', label: 'PvP' },
                { id: 'survival', label: 'Survival' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  filter === tab.id
                    ? 'bg-[#1D2430] text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <label htmlFor="server-search" className="sr-only">
              Buscar servidores
            </label>
            <input
              id="server-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar servidor o IP..."
              className="h-9 pl-9 pr-3 w-56 rounded-lg bg-[#12161C] border border-[#1E242E] text-sm text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleRefreshAll}
            className="h-9 px-3.5 rounded-lg text-xs font-medium text-zinc-200 bg-[#12161C] hover:bg-[#192029] border border-[#242C38] inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Comprobar ping real
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="h-9 px-3.5 rounded-lg text-xs font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Añadir servidor
          </button>
        </div>
      </div>

      {/* Add Server Inline Form */}
      {showAddForm && (
        <form
          onSubmit={handleAddSubmit}
          className="p-5 rounded-xl bg-[#12161C] border border-[#242C38] grid grid-cols-1 md:grid-cols-4 gap-4 items-end"
        >
          <div>
            <label htmlFor="srv-name-input" className="block text-xs font-medium text-zinc-300 mb-1.5">
              Nombre del servidor
            </label>
            <input
              id="srv-name-input"
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (formError) setFormError('');
              }}
              placeholder="Ej. Mi Servidor Survival"
              className="w-full h-10 px-3 rounded-lg bg-[#0B0D10] border border-[#283241] text-sm text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            />
          </div>
          <div>
            <label htmlFor="srv-ip-input" className="block text-xs font-medium text-zinc-300 mb-1.5">
              Dirección IP / Dominio
            </label>
            <input
              id="srv-ip-input"
              type="text"
              value={newAddress}
              onChange={(e) => {
                setNewAddress(e.target.value);
                if (formError) setFormError('');
              }}
              placeholder="Ej. play.miservidor.net"
              className="w-full h-10 px-3 rounded-lg bg-[#0B0D10] border border-[#283241] text-sm font-mono text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            />
          </div>
          <div>
            <label htmlFor="srv-cat-select" className="block text-xs font-medium text-zinc-300 mb-1.5">
              Modalidad
            </label>
            <select
              id="srv-cat-select"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as ServerCategory)}
              className="w-full h-10 px-3 rounded-lg bg-[#0B0D10] border border-[#283241] text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <option value="custom">Personalizado</option>
              <option value="pvp">PvP / Minijuegos</option>
              <option value="survival">Survival</option>
              <option value="skyblock">SkyBlock</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="h-10 flex-1 px-4 rounded-lg text-sm font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 whitespace-nowrap"
            >
              Guardar servidor
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="h-10 px-3 rounded-lg text-sm text-zinc-400 hover:text-white bg-[#171C24] border border-[#283241]"
            >
              Cancelar
            </button>
          </div>
          {formError && <p className="md:col-span-4 text-xs text-red-400">{formError}</p>}
        </form>
      )}

      {/* Server List Table + Network Optimizer */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-8 rounded-xl bg-[#12161C] border border-[#1E242E] overflow-hidden">
          {filteredServers.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-zinc-200">
                No hay servidores que coincidan con tu filtro.
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                Cambia el filtro o añade una nueva dirección IP personalizada.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#1E242E]">
              {filteredServers.map((srv) => {
                const isPinging = Boolean(pingingIds[srv.id]);
                return (
                  <div
                    key={srv.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#161B22] transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => onToggleFavorite(srv.id)}
                          aria-label={
                            srv.favorite
                              ? `Quitar ${srv.name} de favoritos`
                              : `Marcar ${srv.name} como favorito`
                          }
                          className="text-zinc-500 hover:text-amber-400 transition-colors"
                        >
                          <Star
                            className={`w-4 h-4 ${srv.favorite ? 'fill-amber-400 text-amber-400' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                        <h3 className="text-sm font-semibold text-white truncate">{srv.name}</h3>
                        <span className="text-xs font-mono text-zinc-400 truncate">{srv.address}</span>
                      </div>

                      <div className="mt-1 pl-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 tabular-nums">
                        <span className="truncate max-w-md">{srv.motd}</span>
                        <span aria-hidden="true">·</span>
                        {srv.online === false ? (
                          <span className="text-amber-400 font-medium">Sin respuesta TCP</span>
                        ) : (
                          <span className="text-emerald-400 font-medium">
                            En línea · {srv.latencyMs ?? '--'} ms
                          </span>
                        )}
                        {srv.playersOnline !== null && srv.playersMax !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-zinc-300">
                              {srv.playersOnline.toLocaleString('es-ES')} / {srv.playersMax.toLocaleString('es-ES')} jugadores
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pl-6 sm:pl-0">
                      <button
                        type="button"
                        onClick={() => pingSingleServer(srv)}
                        disabled={isPinging}
                        aria-label={`Actualizar ping de ${srv.name}`}
                        className="h-8 px-2.5 rounded-md text-xs text-zinc-300 bg-[#0E1116] hover:bg-[#1D2430] border border-[#242C38] inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        Ping
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyAddress(srv.id, srv.address)}
                        aria-label={`Copiar IP de ${srv.name}`}
                        className="h-8 px-2.5 rounded-md text-xs text-zinc-300 bg-[#0E1116] hover:bg-[#1D2430] border border-[#242C38] inline-flex items-center gap-1"
                      >
                        {copiedId === srv.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        IP
                      </button>

                      <button
                        type="button"
                        onClick={() => onRemoveServer(srv.id)}
                        aria-label={`Eliminar servidor ${srv.name}`}
                        className="h-8 px-2 rounded-md text-zinc-500 hover:text-red-400 bg-[#0E1116] border border-[#242C38]"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onLaunchServer(srv.address, srv.name)}
                        className="h-8 px-3 rounded-md text-xs font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 whitespace-nowrap"
                      >
                        Jugar aquí
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Multiplayer Network Stack Optimizer */}
        <section className="xl:col-span-4 p-5 rounded-xl bg-[#12161C] border border-[#1E242E] space-y-4 h-fit">
          <div>
            <h2 className="font-display text-base font-semibold text-white flex items-center gap-2">
              <Network className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              Optimizador de Red Multijugador
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Ajustes de pila Netty y TCP para minimizar hit-reg delay y pérdida de paquetes en PvP.
            </p>
          </div>

          <label className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#0E1116] border border-[#222A35] cursor-pointer">
            <div>
              <span className="text-xs font-medium text-zinc-200 block">TCP_NODELAY agresivo</span>
              <span className="text-[11px] text-zinc-500">Envía paquetes de golpeo sin buffer Nagle</span>
            </div>
            <input
              type="checkbox"
              checked={network.tcpNoDelay}
              onChange={(e) => onUpdateNetwork({ tcpNoDelay: e.target.checked })}
              className="w-4 h-4 accent-emerald-500"
            />
          </label>

          <label className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#0E1116] border border-[#222A35] cursor-pointer">
            <div>
              <span className="text-xs font-medium text-zinc-200 block">Estabilizador KeepAlive</span>
              <span className="text-[11px] text-zinc-500">Evita desconexiones al cargar chunks pesados</span>
            </div>
            <input
              type="checkbox"
              checked={network.keepAliveStabilizer}
              onChange={(e) => onUpdateNetwork({ keepAliveStabilizer: e.target.checked })}
              className="w-4 h-4 accent-emerald-500"
            />
          </label>

          <label className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#0E1116] border border-[#222A35] cursor-pointer">
            <div>
              <span className="text-xs font-medium text-zinc-200 block">Desactivar telemetría Mojang</span>
              <span className="text-[11px] text-zinc-500">Libera ancho de banda y sockets en segundo plano</span>
            </div>
            <input
              type="checkbox"
              checked={network.disableTelemetry}
              onChange={(e) => onUpdateNetwork({ disableTelemetry: e.target.checked })}
              className="w-4 h-4 accent-emerald-500"
            />
          </label>

          <div className="p-3 rounded-lg bg-[#0E1116] border border-[#222A35] flex items-center justify-between">
            <label htmlFor="netty-threads" className="text-xs font-medium text-zinc-200">
              Hilos de red Netty
            </label>
            <select
              id="netty-threads"
              value={network.nettyThreads}
              onChange={(e) => onUpdateNetwork({ nettyThreads: Number(e.target.value) })}
              className="h-8 px-2.5 rounded bg-[#161B22] border border-[#283241] text-xs font-mono text-white"
            >
              {[2, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n} hilos
                </option>
              ))}
            </select>
          </div>
        </section>
      </div>
    </div>
  );
}
