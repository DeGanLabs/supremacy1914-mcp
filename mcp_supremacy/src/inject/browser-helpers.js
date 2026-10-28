/**
 * Paste into the game page DevTools console (parent page, not iframe).
 * Provides a minimal browser runner using live `hup`.
 *
 * After bundling you can replace this with the real package import.
 */
(function s1914BrowserBootstrap() {
  const iframe = document.getElementById("ifm");
  if (!iframe || !("contentWindow" in iframe) || !iframe.contentWindow) {
    console.error("iframe#ifm missing");
    return;
  }

  let w = iframe.contentWindow;
  let hup = w.hup;
  if (!hup) {
    console.error("hup missing");
    return;
  }

  /** Re-attach after switching games (iframe reloads). */
  function rebind() {
    const el = document.getElementById("ifm");
    if (!el || !el.contentWindow || !el.contentWindow.hup) {
      throw new Error("iframe#ifm hup not ready yet — wait for load");
    }
    w = el.contentWindow;
    hup = w.hup;
    window.s1914.hup = hup;
    return currentGame();
  }

  function currentGame() {
    const ud = hup.config.userData;
    const gi = hup.gameState && hup.gameState.getGameInfoState && hup.gameState.getGameInfoState();
    return {
      gameId: ud.gameID,
      playerId: ud.playerID,
      siteUserId: ud.siteUserID,
      mapId: hup.config.mapID,
      scenario: gi && gi.getScenario && gi.getScenario() && gi.getScenario().ingameName,
      day: gi && gi.getDayOfGame && gi.getDayOfGame(),
      timeScale: gi && gi.getTimeScaleAsMultiplier && gi.getTimeScaleAsMultiplier(),
    };
  }

  /**
   * List all joined maps (indexed). Uses website API getMyGames.
   * Returns a Promise — use: await s1914.listGames()  or  s1914.listGames().then(console.table)
   */
  function listGames() {
    const userId = hup.config.userId || hup.config.userData.siteUserID;
    const currentId = hup.config.userData.gameID;
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        reject(new Error("listGames timed out"));
      }, 15000);
      hup.hupwebapi.getMyGames(userId, function (res) {
        clearTimeout(timer);
        if (!res || res.resultCode !== 0) {
          reject(new Error((res && res.resultMessage) || "getMyGames failed"));
          return;
        }
        const rows = (res.result || []).map(function (entry, index) {
          const p = entry.properties || {};
          const gameId = Number(p.gameID);
          return {
            index: index,
            gameId: gameId,
            title: p.title || "Game " + gameId,
            state: p.state,
            day: p.dayofgame != null ? Number(p.dayofgame) : null,
            players: p.nrofplayers != null ? Number(p.nrofplayers) : null,
            openSlots: p.openSlots != null ? Number(p.openSlots) : null,
            mapReference: p.mapReference || null,
            timeScale: p.timeScale != null ? Number(p.timeScale) : null,
            playerId: p.playerID != null ? Number(p.playerID) : null,
            ranked: String(p.ranked) === "1",
            isCurrent: gameId === currentId,
          };
        });
        window.s1914._gamesIndex = rows;
        resolve({
          siteUserId: userId,
          currentGameId: currentId,
          count: rows.length,
          games: rows,
        });
      });
    });
  }

  /**
   * Switch control to a joined map by index (from listGames) or gameId.
   * After load, call s1914.rebind() (or re-paste this script).
   */
  function useGame(indexOrGameId) {
    const cache = window.s1914._gamesIndex || [];
    let gameId = null;
    let row = null;
    if (
      typeof indexOrGameId === "number" &&
      indexOrGameId >= 0 &&
      indexOrGameId < cache.length &&
      cache[indexOrGameId] &&
      cache[indexOrGameId].index === indexOrGameId
    ) {
      row = cache[indexOrGameId];
      gameId = row.gameId;
    } else {
      const n = Number(indexOrGameId);
      row = cache.find(function (g) {
        return g.gameId === n;
      });
      if (row) gameId = row.gameId;
      else if (Number.isFinite(n) && n > 1000) gameId = n;
    }
    if (!gameId) {
      throw new Error("useGame: run listGames() first, then useGame(index) or useGame(gameId)");
    }
    if (gameId === hup.config.userData.gameID) {
      return { ok: true, already: true, gameId: gameId, title: row && row.title };
    }
    hup.gameController.startLoadingTheGame(gameId, false);
    return {
      ok: true,
      switchingTo: gameId,
      title: row && row.title,
      playerIdInGame: row && row.playerId,
      note: "Wait for map load, then run s1914.rebind() (or re-paste browser-console.js). Then exportSession({secrets:true}) for new keys.",
    };
  }

  function dumpResources() {
    const res = hup.gameState.getResourceState();
    const ids = [];
    for (let i = 0; i <= 30; i++) ids.push(i);
    ids.push(20);
    const seen = {};
    const resources = ids
      .map((id) => {
        if (seen[id]) return null;
        seen[id] = true;
        const name = res.getResourceName(id);
        const e = res.getPlayerResourceEntry(id);
        if (!name || !e) return null;
        const amount = e.getAmount();
        const rate = e.getRate();
        return {
          id,
          name,
          amount,
          production: e.getProduction(),
          consumption: e.getConsumption(),
          rate,
          isCritical: !!(e.isRateCritical && e.isRateCritical()),
          hoursToZero:
            rate < 0 && amount > 0
              ? Math.round((amount / Math.abs(rate)) * 10) / 10
              : null,
        };
      })
      .filter(Boolean);
    return {
      money: res.getPlayerMoneyAmount ? res.getPlayerMoneyAmount() : 0,
      resources,
    };
  }

  function mapCommandDump(c) {
    const tp = (c.getTargetPos && c.getTargetPos()) || c.targetPos || null;
    return {
      kind: (
        c["@c"] ||
        (c.getCommandIconName && c.getCommandIconName()) ||
        ""
      ).toString(),
      waitSeconds: c.waitSeconds,
      target: tp && tp.x != null ? { x: tp.x, y: tp.y } : tp,
      targetArmyId: c.targetUnitID,
    };
  }

  function mapArmyRuntime(a) {
    const cmds = (a.getCommands && a.getCommands()) || [];
    let wait = 0;
    for (let i = 0; i < cmds.length; i++) {
      wait += Number(cmds[i].waitSeconds) || 0;
    }
    return {
      commands: cmds.map(mapCommandDump),
      commandCount: cmds.length,
      waitSeconds: wait > 0 ? wait : null,
      speed: a.getSpeed && a.getSpeed(),
      currentSpeed: a.getCurrentSpeed && a.getCurrentSpeed(),
      forcedMarch: !!(a.getForcedMarch && a.getForcedMarch()),
      range: a.getRange && a.getRange(),
      morale: a.getVisibleMorale ? a.getVisibleMorale() : a.morale,
    };
  }

  function flatBorderRing(ring) {
    if (!ring) return null;
    const out = [];
    if (Array.isArray(ring) && typeof ring[0] === "number") {
      for (let i = 0; i < ring.length; i++) out.push(Number(ring[i]));
      return out.length >= 6 ? out : null;
    }
    const len =
      ring.length != null
        ? Number(ring.length)
        : Object.keys(ring).filter((k) => /^\d+$/.test(k)).length;
    for (let i = 0; i < len; i++) {
      const v = ring[i];
      if (v == null) continue;
      out.push(Number(v));
    }
    return out.length >= 6 ? out : null;
  }

  function provinceBorders(p) {
    try {
      const raw = p.borders;
      if (!raw) return [];
      const rings = Array.isArray(raw) ? raw : [raw];
      return rings
        .map(flatBorderRing)
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function provinceBounds(p) {
    try {
      const b = p.bounds;
      if (!b) return null;
      const x0 = Number(b[0] ?? b.minX);
      const y0 = Number(b[1] ?? b.minY);
      const x1 = Number(b[2] ?? b.maxX);
      const y1 = Number(b[3] ?? b.maxY);
      if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } catch (e) {
      return null;
    }
  }

  function dumpFinanceProvinces() {
    rebind();
    const gs = hup.gameState;
    if (!gs) throw new Error("gameState missing — wait for map load");
    const map = gs.getMapState && gs.getMapState();
    if (!map || typeof map.getPlayerProvinces !== "function") {
      throw new Error("mapState not ready — retry get_finance_picture in a few seconds");
    }
    const self = hup.config.userData.playerID;
    const provs = map.getPlayerProvinces(self) || [];
    const provinces = provs.map((p) => {
      const cap = p.getCapital ? p.getCapital() : p.capital;
      let resourceType = null;
      let mainProduction = null;
      let taxProduction = null;
      let revoltChance = null;
      try {
        resourceType =
          (p.getResourceType && p.getResourceType()) ||
          (p.getResourceName && p.getResourceName()) ||
          null;
        if (resourceType && typeof resourceType === "object") {
          resourceType =
            resourceType.getName?.() ||
            resourceType.name ||
            String(resourceType);
        }
      } catch (e) {}
      try {
        mainProduction = p.getMainProduction ? p.getMainProduction() : null;
      } catch (e) {}
      try {
        taxProduction = p.getTaxProduction ? p.getTaxProduction() : null;
      } catch (e) {}
      try {
        revoltChance = p.getRevoltChance ? p.getRevoltChance() : null;
      } catch (e) {}
      const improvements = (
        p.getImprovementsBuilt
          ? p.getImprovementsBuilt()
          : p.improvements || []
      ).map((u) => ({
        id: u.getItemID ? u.getItemID() : u.itemID,
        name: u.getNameWithLevel
          ? u.getNameWithLevel()
          : u.getNameWithTier
            ? u.getNameWithTier()
            : u.getName
              ? u.getName()
              : null,
        condition: u.getCondition ? u.getCondition() : u.condition,
      }));
      return {
        id: p.getLocationID ? p.getLocationID() : p.getProvinceID && p.getProvinceID(),
        name: p.getName && p.getName(),
        capital: cap ? { x: cap.x, y: cap.y } : null,
        coastal: p.isCoastal ? p.isCoastal() : !!p.coastal,
        morale: p.getMorale && p.getMorale(),
        resourceType,
        mainProduction,
        taxProduction,
        revoltChance,
        buildings: improvements,
        borders: provinceBorders(p),
        bounds: provinceBounds(p),
        terrainType:
          p.terrainType != null
            ? p.terrainType
            : p.visualTerrainType != null
              ? p.visualTerrainType
              : null,
      };
    });
    return {
      selfPlayerId: self,
      mapSize: {
        width: map.getWidth && map.getWidth(),
        height: map.getHeight && map.getHeight(),
      },
      provinces,
    };
  }

  function dumpOwnArmies() {
    const pid = hup.config.userData.playerID;
    const map = hup.gameState.getMapState();
    return hup.gameState
      .getArmyState()
      .getArmiesArray()
      .filter((a) => a.getOwnerID() === pid)
      .map((a) => {
        const pos = a.getPosition();
        const prov = map.getProvinceAt(pos);
        return {
          id: a.getArmyID(),
          province: prov && prov.getName && prov.getName(),
          pos: { x: pos.x, y: pos.y },
          onSea: a.isOnSea(),
          units: (a.getUnits() || []).map((u) => {
            const t = u.getEffectiveUnitType && u.getEffectiveUnitType();
            return {
              name: t && t.getName && t.getName(),
              size: u.getSize && u.getSize(),
              typeId: (t && t.getItemID && t.getItemID()) || (u.getTypeID && u.getTypeID()) || 0,
              morale: u.getMorale && u.getMorale(),
            };
          }),
          ...mapArmyRuntime(a),
        };
      });
  }

  function mapMoveError(msg, onSea) {
    const s = String(msg || "");
    if (/Bewegung zum Zielpunkt nicht m[oö]glich/i.test(s)) {
      return onSea
        ? "move not possible — land destination for sea unit, or no water path (raw: " +
            s +
            ")"
        : "move not possible — no land path to target (raw: " + s + ")";
    }
    return s || "invalid command";
  }

  function readCommandTarget(cmd) {
    if (!cmd) return null;
    try {
      const tp =
        (cmd.getTargetPosition && cmd.getTargetPosition()) ||
        cmd.targetPos ||
        cmd.target ||
        null;
      if (!tp) return null;
      const x = Number(tp.x != null ? tp.x : tp.getX && tp.getX());
      const y = Number(tp.y != null ? tp.y : tp.getY && tp.getY());
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x: x, y: y };
    } catch (e) {
      return null;
    }
  }

  async function moveArmy(armyId, targetX, targetY, opts) {
    rebind();
    const append = !!(opts && opts.append);
    const army = hup.gameState.getArmyState().getArmy(armyId);
    if (!army) throw new Error("army not found");
    if (army.getOwnerID() !== hup.config.userData.playerID) {
      throw new Error("army " + armyId + " is not yours");
    }
    const onSea = !!(army.isOnSea && army.isOnSea());
    const startPos = army.getPosition();
    const Point = startPos.constructor;
    // Sea units must snap to water; land units to land.
    const target = hup.gameState
      .getMapState()
      .closestMapPoint(new Point(Number(targetX), Number(targetY)), onSea);
    const dist = Math.hypot(startPos.x - target.x, startPos.y - target.y);
    if (dist < 12 && !append) {
      throw new Error(
        "target too close to army (" +
          Math.round(dist) +
          " map units) — bad coords or already there (raw " +
          targetX +
          "," +
          targetY +
          ")",
      );
    }
    // Pre-refuse obvious inland snap for fleets (raw was far from water snap).
    if (onSea) {
      const rawDist = Math.hypot(
        Number(targetX) - target.x,
        Number(targetY) - target.y,
      );
      if (rawDist > 80) {
        throw new Error(
          "move not possible — land destination for sea unit (raw " +
            Math.round(Number(targetX)) +
            "," +
            Math.round(Number(targetY)) +
            " snapped water " +
            Math.round(target.x) +
            "," +
            Math.round(target.y) +
            ")",
        );
      }
    }
    const cmdsBefore = (army.getCommands() || []).length;
    try {
      hup.armySelection.setSelected([]);
    } catch (e) {}
    hup.armySelection.setSelected([army]);
    const ac = hup.mapMouseController.armyController;
    ac.updateMoveSelection();
    ac.setCommandMode(0);
    if (typeof ac.setAppendMode === "function") {
      try {
        ac.setAppendMode(!!append);
      } catch (e) {}
    }
    ac.setDragTarget(target, null);
    if (!ac.isValidCommand) {
      throw new Error(mapMoveError(ac.message, onSea));
    }
    ac.sendAction();

    let cmdsAfter = cmdsBefore;
    let after = army;
    let observedTarget = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(function (r) {
        setTimeout(r, 80);
      });
      rebind();
      after = hup.gameState.getArmyState().getArmy(armyId);
      const cmds = after ? after.getCommands() || [] : [];
      cmdsAfter = cmds.length;
      // Prefer verifying last command targetPos near intended point.
      for (let j = cmds.length - 1; j >= 0; j--) {
        const tp = readCommandTarget(cmds[j]);
        if (tp) {
          observedTarget = tp;
          break;
        }
      }
      if (
        observedTarget &&
        Math.hypot(observedTarget.x - target.x, observedTarget.y - target.y) < 40
      ) {
        break;
      }
      if (!append && cmdsAfter > cmdsBefore && observedTarget) break;
      if (append && cmdsAfter > cmdsBefore) break;
    }
    const destProv = hup.gameState.getMapState().getProvinceAt(target);
    const destName =
      destProv && destProv.getName ? destProv.getName() : null;
    const verified =
      observedTarget &&
      Math.hypot(observedTarget.x - target.x, observedTarget.y - target.y) < 40;
    if (!verified && cmdsAfter <= cmdsBefore) {
      throw new Error(
        "move did not queue on army " +
          armyId +
          (destName ? " → " + destName : "") +
          " (still " +
          cmdsAfter +
          " cmds) — retry or move manually",
      );
    }
    if (!verified) {
      throw new Error(
        "move queued but targetPos not verified for army " +
          armyId +
          (observedTarget
            ? " (observed " +
              Math.round(observedTarget.x) +
              "," +
              Math.round(observedTarget.y) +
              " vs " +
              Math.round(target.x) +
              "," +
              Math.round(target.y) +
              ")"
            : " — no targetPos on commands") +
          (onSea ? " [sea unit]" : ""),
      );
    }
    return {
      ok: true,
      verified: true,
      armyId,
      onSea: onSea,
      append: !!append,
      target: { x: target.x, y: target.y },
      observedTarget: observedTarget,
      destinationProvince: destName,
      from: { x: startPos.x, y: startPos.y },
      distance: Math.round(dist),
      commandsBefore: cmdsBefore,
      commandsAfter: cmdsAfter,
    };
  }

  /** Move multiple armies to the same point (shared selection when possible). */
  async function moveArmies(armyIds, targetX, targetY, opts) {
    const ids = (armyIds || []).map(Number).filter(function (id) {
      return Number.isFinite(id) && id > 0;
    });
    if (!ids.length) throw new Error("moveArmies needs armyIds");
    rebind();
    const armies = [];
    for (let i = 0; i < ids.length; i++) {
      const a = hup.gameState.getArmyState().getArmy(ids[i]);
      if (!a) throw new Error("army not found: " + ids[i]);
      if (a.getOwnerID() !== hup.config.userData.playerID) {
        throw new Error("army " + ids[i] + " is not yours");
      }
      armies.push(a);
    }
    try {
      hup.armySelection.setSelected([]);
    } catch (e) {}
    try {
      hup.armySelection.setSelected(armies, false);
    } catch (e) {
      // Fallback: sequential single moves
      const results = [];
      for (let i = 0; i < ids.length; i++) {
        if (i > 0) {
          await new Promise(function (r) {
            setTimeout(r, 450);
          });
        }
        results.push(await moveArmy(ids[i], targetX, targetY, opts));
      }
      return { ok: true, mode: "sequential", results: results };
    }
    const anySea = armies.some(function (a) {
      return a.isOnSea && a.isOnSea();
    });
    const Point = armies[0].getPosition().constructor;
    const target = hup.gameState
      .getMapState()
      .closestMapPoint(new Point(Number(targetX), Number(targetY)), anySea);
    const ac = hup.mapMouseController.armyController;
    ac.updateMoveSelection();
    ac.setCommandMode(0);
    if (typeof ac.setAppendMode === "function") {
      try {
        ac.setAppendMode(!!(opts && opts.append));
      } catch (e) {}
    }
    ac.setDragTarget(target, null);
    if (!ac.isValidCommand) {
      throw new Error(mapMoveError(ac.message, anySea));
    }
    ac.sendAction();
    await new Promise(function (r) {
      setTimeout(r, 350);
    });
    // Verify at least one army got a matching targetPos
    let verified = 0;
    for (let i = 0; i < ids.length; i++) {
      const a = hup.gameState.getArmyState().getArmy(ids[i]);
      const cmds = a ? a.getCommands() || [] : [];
      for (let j = cmds.length - 1; j >= 0; j--) {
        const tp = readCommandTarget(cmds[j]);
        if (
          tp &&
          Math.hypot(tp.x - target.x, tp.y - target.y) < 40
        ) {
          verified++;
          break;
        }
      }
    }
    if (!verified) {
      throw new Error(
        "multi-move sent but no army verified targetPos near " +
          Math.round(target.x) +
          "," +
          Math.round(target.y),
      );
    }
    const destProv = hup.gameState.getMapState().getProvinceAt(target);
    return {
      ok: true,
      verified: true,
      mode: "multi",
      armyIds: ids,
      verifiedCount: verified,
      destinationProvince: destProv && destProv.getName ? destProv.getName() : null,
      target: { x: target.x, y: target.y },
    };
  }

  /** Attack / bombard enemy army. Same wire `@c:"ac"`; bombard = ranged fight status. */
  function attackArmy(armyId, targetArmyId) {
    const army = hup.gameState.getArmyState().getArmy(armyId);
    if (!army) throw new Error("army not found");
    if (army.getOwnerID() !== hup.config.userData.playerID) {
      throw new Error("army " + armyId + " is not yours");
    }
    const targetArmy = hup.gameState.getArmyState().getArmy(targetArmyId);
    if (!targetArmy) throw new Error("target army not found");
    const pos = targetArmy.getPosition();
    const Point = army.getPosition().constructor;
    const attackerOnSea = !!(army.isOnSea && army.isOnSea());
    const target = hup.gameState
      .getMapState()
      .closestMapPoint(new Point(pos.x, pos.y), attackerOnSea);
    hup.armySelection.setSelected([army]);
    const ac = hup.mapMouseController.armyController;
    ac.updateMoveSelection();
    ac.setCommandMode(2); // Y0.ATTACK
    ac.setDragTarget(target, targetArmy);
    if (!ac.isValidCommand) {
      throw new Error(ac.message || "invalid attack");
    }
    ac.sendAction();
    return {
      ok: true,
      armyId,
      targetArmyId,
      range: army.getRange && army.getRange(),
      isBombarding: !!(army.isBombarding && army.isBombarding()),
      willBombard:
        !!(army.isBombarding && army.isBombarding()) ||
        ((army.getRange && army.getRange()) || 0) >= 50,
      target,
    };
  }

  /** UI Delay in minutes (uses game timeScale). */
  function delayArmy(armyId, minutes, syncArrival) {
    if (!(minutes > 0)) throw new Error("minutes must be > 0");
    const army = hup.gameState.getArmyState().getArmy(armyId);
    if (!army) throw new Error("army not found");
    if (army.getOwnerID() !== hup.config.userData.playerID) {
      throw new Error("army " + armyId + " is not yours");
    }
    hup.armySelection.setSelected([army]);
    const ac = hup.mapMouseController.armyController;
    ac.updateMoveSelection();
    ac.setSelectedWaitTime(!!syncArrival, Number(minutes));
    ac.sendDelayAction();
    const gi = hup.gameState.getGameInfoState();
    const scale =
      (gi.getTimeScaleAsMultiplier && gi.getTimeScaleAsMultiplier()) ||
      gi.getTimeScale() ||
      1;
    return {
      ok: true,
      armyId,
      minutes,
      gameSeconds: Math.floor((60 * minutes) / scale),
      timeScale: scale,
      syncArrival: !!syncArrival,
    };
  }

  /** Forced march on/off — sends immediately. Works for infantry and heroes. */
  function setForcedMarch(armyId, enabled) {
    const army = hup.gameState.getArmyState().getArmy(armyId);
    if (!army) throw new Error("army not found");
    hup.armySelection.setSelected([army]);
    const ac = hup.mapMouseController.armyController;
    ac.updateMoveSelection();
    ac.setForcedMarch(!!enabled);
    return {
      ok: true,
      armyId,
      forcedMarch: !!enabled,
      canEnable: army.canEnableForcedMarch && army.canEnableForcedMarch(),
      speedFactor: army.getForcedMarchSpeedFactor && army.getForcedMarchSpeedFactor(),
    };
  }

  /**
   * Aggressiveness 1–5 (0 = default). Solo heroes often allow 1–5;
   * infantry stacks typically 2–5. Must be selected for move to apply.
   */
  function setAggression(armyId, level) {
    const army = hup.gameState.getArmyState().getArmy(armyId);
    if (!army) throw new Error("army not found");
    hup.armySelection.setSelected([army]);
    const ac = hup.mapMouseController.armyController;
    ac.updateMoveSelection();
    const selectable = [
      ...(army.getSelectableAggressivenesses &&
        army.getSelectableAggressivenesses()) || [],
    ];
    if (selectable.length && selectable.indexOf(level) < 0) {
      throw new Error("aggressiveness not selectable: " + selectable.join(","));
    }
    ac.setAggressiveness(Number(level));
    if (ac.isValidCommand) ac.sendAction();
    return {
      ok: true,
      armyId,
      aggressiveness: Number(level),
      selectable,
      effective: army.getEffectiveAggressiveness && army.getEffectiveAggressiveness(),
    };
  }

  function dumpArmyCombat(armyId) {
    const army = hup.gameState.getArmyState().getArmy(armyId);
    if (!army) throw new Error("army not found");
    const hsm = hup.heroSystemManager;
    const units = (army.getUnits() || []).map((u) => {
      let name = null;
      let typeId = null;
      let hero = false;
      try {
        const t = u.getEffectiveUnitType && u.getEffectiveUnitType();
        name = t && t.getName && t.getName();
        typeId = t && t.getItemID && t.getItemID();
        hero = !!(
          hsm &&
          typeId &&
          hsm.getHeroUnitItemByUnitTypeId &&
          hsm.getHeroUnitItemByUnitTypeId(typeId)
        );
      } catch (e) {}
      return { name, typeId, size: u.getSize && u.getSize(), hero };
    });
    const cmds = (army.getCommands() || []).map((c) => ({
      "@c": c["@c"],
      icon: c.getCommandIconName && c.getCommandIconName(),
      waitSeconds: c.waitSeconds,
      direction: c.direction,
      targetUnitID: c.targetUnitID,
      targetPos: c.targetPos || (c.getTargetPos && c.getTargetPos()),
    }));
    return {
      id: army.getArmyID(),
      units,
      range: army.getRange && army.getRange(),
      canAttack: army.canAttack && army.canAttack(),
      isAttacking: army.isAttacking && army.isAttacking(),
      isBombarding: army.isBombarding && army.isBombarding(),
      attackArmyId: army.getAttackArmyID && army.getAttackArmyID(),
      forcedMarch: army.getForcedMarch && army.getForcedMarch(),
      canForcedMarch: army.canEnableForcedMarch && army.canEnableForcedMarch(),
      speed: army.getSpeed && army.getSpeed(),
      currentSpeed: army.getCurrentSpeed && army.getCurrentSpeed(),
      fmFactor: army.getForcedMarchSpeedFactor && army.getForcedMarchSpeedFactor(),
      aggressiveness: army.getAggressiveness && army.getAggressiveness(),
      effectiveAggression:
        army.getEffectiveAggressiveness && army.getEffectiveAggressiveness(),
      selectableAggression: [
        ...((army.getSelectableAggressivenesses &&
          army.getSelectableAggressivenesses()) ||
          []),
      ],
      canSetAggression: army.canSetAggressiveness && army.canSetAggressiveness(),
      commands: cmds,
    };
  }

  function decodeHtml(input) {
    return String(input || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#x27;/gi, "'")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, " ")
      .replace(/<[^>]+>/g, "");
  }

  function playerMap() {
    const map = {};
    for (const p of hup.gameState.getPlayerState().getPlayersArray()) {
      map[p.getPlayerID()] = {
        playerId: p.getPlayerID(),
        name: p.getName && p.getName(),
        nationName: p.getNationName && p.getNationName(),
      };
    }
    return map;
  }

  function mapMessage(m, players) {
    const body = m.getMessageBody() || "";
    const allianceId = (m.getAllianceID && m.getAllianceID()) || m.allianceID || 0;
    const senderId = m.getSenderID();
    const receiverId = m.getReceiverID();
    return {
      uid: m.getMessageUID(),
      title: m.getTitle() || "",
      bodyText: decodeHtml(body),
      senderId,
      receiverId,
      authorId: m.getAuthorID(),
      sender: players[senderId],
      receiver: players[receiverId],
      day: m.getDay(),
      timeLabel: m.getTime && m.getTime(),
      timestamp: m.getTimeStamp(),
      allianceId,
      isAllianceMessage: allianceId > 0,
      isSystemMessage: !!(m.isSystemMessage && m.isSystemMessage()),
    };
  }

  function mapTrade(o) {
    const asLabels = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);
    return {
      tradeId: o.getTradeID(),
      senderId: o.getSenderID(),
      receiverId: o.getReceiverID(),
      offerA: asLabels(o.getOffersAAsString()),
      offerB: asLabels(o.getOffersBAsString()),
      offerAType: o.getOfferAType(),
      offerBType: o.getOfferBType(),
      message: o.message || "",
      dateLabel: o.getDate && o.getDate(),
      timeLabel: o.getTime && o.getTime(),
      processed: o.isProcessed(),
      successful: o.isSuccessful(),
    };
  }

  function dumpAllMessages() {
    const players = playerMap();
    const fa = hup.gameState.getForeignAffairsState();
    const trading = hup.gameState.getResourceState().getTrading();
    const pid = hup.config.userData.playerID;
    const messages = (fa.getMessages() || []).map((m) => mapMessage(m, players));
    const allianceMessages = (fa.getAllianceMessages() || []).map((m) =>
      mapMessage(m, players),
    );

    const threadsMap = {};
    for (const msg of messages) {
      const other =
        msg.isAllianceMessage && msg.receiverId < 0
          ? msg.receiverId
          : msg.senderId === pid
            ? msg.receiverId
            : msg.senderId;
      if (!threadsMap[other]) threadsMap[other] = [];
      threadsMap[other].push(msg);
    }

    const threads = Object.keys(threadsMap)
      .map((k) => {
        const otherPlayerId = Number(k);
        const list = threadsMap[k].slice().sort((a, b) => a.timestamp - b.timestamp);
        return {
          otherPlayerId,
          other: players[otherPlayerId] || { playerId: otherPlayerId },
          count: list.length,
          messages: list,
        };
      })
      .sort((a, b) => b.count - a.count);

    return {
      selfPlayerId: pid,
      total: messages.length,
      allianceTotal: allianceMessages.length,
      unread: {
        total: fa.getUnreadCommunications(pid),
        articles: fa.getUnreadArticleNum(pid),
        coalition: fa.getUnreadCoalitionMessagesCount(pid),
        trades: trading.getNewOfferCount(pid),
      },
      threads: threads.map((t) => {
        const recent = t.messages.slice(-3);
        return {
          otherPlayerId: t.otherPlayerId,
          other: t.other,
          count: t.count,
          last: t.messages[t.messages.length - 1] && {
            bodyText: t.messages[t.messages.length - 1].bodyText.slice(0, 400),
            timestamp: t.messages[t.messages.length - 1].timestamp,
          },
          recent: recent.map((m) => ({
            bodyText: String(m.bodyText || "").slice(0, 400),
            timestamp: m.timestamp,
            senderId: m.senderId,
          })),
        };
      }),
      allianceMessages,
      openTrades: (trading.tradingOffers || []).map(mapTrade),
      pastTradesCount: (trading.pastTrades || []).length,
      coalitionEvents: (fa.getCoalitionMessagesInEventQueue() || []).map((e) => ({
        messageId: e.messageID,
        name: e.name,
        description: e.description,
        filterName: e.filterName,
        time: e.time,
      })),
    };
  }

  function dumpRelatedWith(otherPlayerId) {
    const players = playerMap();
    const fa = hup.gameState.getForeignAffairsState();
    const trading = hup.gameState.getResourceState().getTrading();
    const pid = hup.config.userData.playerID;
    const thread = (fa.getArticlesForPlayers(pid, otherPlayerId) || [])
      .map((m) => mapMessage(m, players))
      .sort((a, b) => a.timestamp - b.timestamp);
    return {
      other: players[otherPlayerId] || { playerId: otherPlayerId },
      messageCount: thread.length,
      messages: thread,
      openTrades: (trading.getTradeOffersForPlayers(pid, otherPlayerId) || []).map(
        mapTrade,
      ),
      pastTrades: (trading.getPastTradeOffersForPlayers(pid, otherPlayerId) || []).map(
        mapTrade,
      ),
      allianceFromThem: (fa.getAllianceMessages() || [])
        .map((m) => mapMessage(m, players))
        .filter((m) => m.senderId === otherPlayerId || m.authorId === otherPlayerId),
    };
  }

  function dumpRelatedByName(nameOrNation) {
    const needle = String(nameOrNation).toLowerCase();
    const players = playerMap();
    const match = Object.values(players).find(
      (p) =>
        (p.name && p.name.toLowerCase() === needle) ||
        (p.nationName && p.nationName.toLowerCase() === needle),
    );
    if (!match) return { error: "player not found", needle };
    return dumpRelatedWith(match.playerId);
  }

  function dumpAllStats() {
    const gs = hup.gameState;
    const pid = hup.config.userData.playerID;
    const pss = gs.getPlayerStatisticsState();
    const gi = gs.getGameInfoState();
    const map = gs.getMapState();
    const provs = map.getPlayerProvinces(pid) || [];
    const avgMorale =
      provs.length === 0
        ? 0
        : provs.reduce((s, p) => s + p.getMorale(), 0) / provs.length;

    const ranking = gs
      .getPlayerState()
      .getPlayersArray()
      .map((p) => ({
        playerId: p.getPlayerID(),
        name: p.getName && p.getName(),
        nationName: p.getNationName && p.getNationName(),
        rankingOrder: p.getRankingOrder && p.getRankingOrder(),
        defeated: !!(p.isDefeated && p.isDefeated()),
        coalition:
          p.getCoalition &&
          p.getCoalition() &&
          (p.getCoalition().getName
            ? p.getCoalition().getName()
            : p.getCoalition()),
      }))
      .filter((p) => p.nationName)
      .sort((a, b) => (a.rankingOrder || 999) - (b.rankingOrder || 999));

    const allianceObj = gs.getInGameAllianceState().getAlliance();
    const alliance = allianceObj
      ? {
          id: allianceObj.getID(),
          name: allianceObj.getName(),
          score: allianceObj.getScore(),
          members: allianceObj.getMemberCount(),
          provinces: allianceObj.getProvinceCount(),
          leaderId: allianceObj.getLeaderID(),
        }
      : null;

    const spy = gs.getSpyState();
    const spies = spy
      ? {
          total: spy.getNumAllSpies(),
          idle: spy.getNumOfIdleSpies(),
          onMission: spy.getNumSpiesOnMission(),
        }
      : null;

    return {
      gameInfo: {
        day: gi.getDayOfGame(),
        remaining: gi.getRemainingDayTimeHR(),
        speed: gi.getTimeScaleAsMultiplier() + "x",
        scenario: gi.getScenario() && gi.getScenario().ingameName,
        players: gi.getNumberOfPlayers(),
        vpTarget: gi.getVictoryPoints(),
        vpPercent: gi.getVictoryPercent(),
      },
      combat: {
        kills: pss.getNumKills(pid),
        deaths: pss.getNumDeaths(pid),
        kd:
          pss.getNumDeaths(pid) > 0
            ? Math.round((pss.getNumKills(pid) / pss.getNumDeaths(pid)) * 100) /
              100
            : pss.getNumKills(pid),
        provincesCaptured: pss.getNumProvincesCaptured(pid),
        provincesLost: pss.getNumProvincesLost(pid),
        netProvinces:
          pss.getNumProvincesCaptured(pid) - pss.getNumProvincesLost(pid),
        constructed: pss.getNumConstructed(pid),
        units: pss
          .getUnitStatsMap()
          .filter((u) => u.killed || u.produced)
          .map((u) => ({
            name: u.unitType.getName && u.unitType.getName(),
            killed: u.killed,
            produced: u.produced,
          })),
      },
      provinces: {
        count: provs.length,
        averageMorale: Math.round(avgMorale * 10) / 10,
        list: (function () {
          try {
            return (dumpFinanceProvinces().provinces || []).map((p) => ({
              name: p.name,
              morale: p.morale,
              revoltChance: p.revoltChance,
              mainProduction: p.mainProduction,
              coastal: p.coastal,
            }));
          } catch (e) {
            return [];
          }
        })(),
      },
      selfRank: ranking.find((r) => r.playerId === pid),
      top10: ranking.slice(0, 10),
      alliance,
      spies,
      events: (gs.getGameEventState().getEvents() || []).length,
      stateTypes: Object.keys(gs.getStatesList() || {}),
    };
  }

  function dumpDiplomacy() {
    const REL = {
      "-10": "revolt",
      "-2": "war",
      "-1": "ceasefire",
      "0": "trade_embargo",
      "1": "peace",
      "2": "non_aggression_pact",
      "3": "right_of_way",
      "4": "view_military_actions",
      "5": "mutual_protection",
      "6": "shared_intelligence",
      "7": "military_authority",
    };
    const gs = hup.gameState;
    const pid = hup.config.userData.playerID;
    const fa = gs.getForeignAffairsState();
    const rel = fa.getRelations();
    const rows = gs
      .getPlayerState()
      .getPlayersArray()
      .filter((p) => p.getNationName && p.getNationName() && p.getPlayerID() !== pid)
      .map((p) => {
        const id = p.getPlayerID();
        const relation = rel.getRelation(pid, id);
        return {
          id,
          name: p.getName && p.getName(),
          nation: p.getNationName && p.getNationName(),
          relation,
          label: REL[String(relation)] || relation,
          superficial: rel.superficialRelationBetween && rel.superficialRelationBetween(pid, id),
          war: !!(fa.isAtWar && fa.isAtWar(pid, id)),
          row: !!(fa.hasRightOfWay && fa.hasRightOfWay(pid, id)),
          canSeeArmies: !!(fa.canSeeArmies && fa.canSeeArmies(pid, id)),
          canSeeEachOthersArmies: !!(
            fa.canSeeEachOthersArmies && fa.canSeeEachOthersArmies(pid, id)
          ),
          canAttack: !!(fa.canAttack && fa.canAttack(pid, id)),
          canUseAirfields: !!(fa.canUseAirfields && fa.canUseAirfields(pid, id)),
          canCommandProvinces: !!(
            fa.canCommandProvinces && fa.canCommandProvinces(pid, id)
          ),
          honorPeriodEnd:
            rel.getEndOfHonorPeriod && rel.getEndOfHonorPeriod(pid, id),
          canTrade: !!(rel.canTrade && rel.canTrade(pid, id)),
          defeated: !!(p.isDefeated && p.isDefeated()),
          rank: p.getRankingOrder && p.getRankingOrder(),
          coalition:
            p.getCoalition &&
            p.getCoalition() &&
            (p.getCoalition().getName ? p.getCoalition().getName() : p.getCoalition()),
        };
      })
      .sort((a, b) => a.relation - b.relation || (a.rank || 999) - (b.rank || 999));

    const hist = {};
    for (const r of rows) hist[r.label] = (hist[r.label] || 0) + 1;

    const atWarAll = rows.filter((r) => r.war);
    const atWar = atWarAll.filter((r) => {
      if (r.defeated) return false;
      try {
        const pl = gs.getPlayerState().getPlayer(r.id);
        if (pl && pl.isRetired && pl.isRetired()) return false;
      } catch (e) {}
      return true;
    });

    return {
      total: rows.length,
      histogram: hist,
      /** Live wars (not defeated/retired). */
      atWar,
      /** Paper wars — defeated/retired still flagged at war in diplo. */
      atWarDefeated: atWarAll.filter((r) => !atWar.some((a) => a.id === r.id)),
      atWarAll,
      rightOfWay: rows.filter((r) => r.relation === 3),
      shareMapOrBetter: rows.filter((r) => r.relation >= 4),
      enemies: fa.getEnemies && fa.getEnemies(pid),
      allies: fa.getAllies && fa.getAllies(pid),
      nonPeace: rows.filter((r) => r.relation !== 1),
      rows,
      neighborRelations: rel.neighborRelations || null,
    };
  }

  function dumpCountryStats(onlyIds) {
    const gs = hup.gameState;
    const pid = hup.config.userData.playerID;
    const pss = gs.getPlayerStatisticsState();
    const fa = gs.getForeignAffairsState();
    const rel = fa.getRelations();
    const allow = onlyIds ? new Set(onlyIds) : null;
    return gs
      .getPlayerState()
      .getPlayersArray()
      .filter((p) => {
        const id = p.getPlayerID();
        if (id === pid) return false;
        if (!(p.getNationName && p.getNationName())) return false;
        if (allow && !allow.has(id)) return false;
        return true;
      })
      .map((p) => {
        const id = p.getPlayerID();
        const relation = rel.getRelation(pid, id);
        return {
          id,
          name: p.getName && p.getName(),
          nation: p.getNationName && p.getNationName(),
          rank: p.getRankingOrder && p.getRankingOrder(),
          defeated: !!(p.isDefeated && p.isDefeated()),
          relation,
          war: !!(fa.isAtWar && fa.isAtWar(pid, id)),
          kills: pss.getNumKills(id),
          deaths: pss.getNumDeaths(id),
          caps: pss.getNumProvincesCaptured(id),
          lost: pss.getNumProvincesLost(id),
        };
      })
      .sort((a, b) => (a.rank || 999) - (b.rank || 999));
  }

  function dumpSpies(includeAllDays) {
    const spy = hup.gameState.getSpyState();
    if (!spy) return null;
    const map = hup.gameState.getMapState();
    const report = spy.getSpyReport();
    const agents = (spy.getSpies() || []).map((sp) => {
      const loc = sp.getLocationID();
      let provName = null;
      try {
        const all = map.getProvinceArray ? map.getProvinceArray() : [];
        const hit = all.find((p) => p.getProvinceID && p.getProvinceID() === loc);
        provName = hit && hit.getName && hit.getName();
      } catch (e) {}
      return {
        unitUID: sp.unitUID,
        mission: spy.getNameForMission(sp.getMissionType()),
        missionType: sp.getMissionType(),
        locationID: loc,
        province: provName,
        provinceOwner: sp.provinceOwner,
        morale: sp.morale,
        dailyCosts: sp.getDailyCosts(),
        kills: sp.kills != null ? sp.kills : sp.getKills && sp.getKills(),
        size: sp.getSize ? sp.getSize() : sp.size,
        onSea: !!(sp.isOnSea && sp.isOnSea()),
        atAirfield: !!(sp.isAtAirfield && sp.isAtAirfield()),
      };
    });

    const currentDay = report && report.currentDay;
    const days = report ? Object.keys(report.dailyStates || {}).map(Number).sort((a, b) => a - b) : [];
    const daysToRead = includeAllDays ? days : currentDay != null ? [currentDay] : days.slice(-1);
    const intel = [];
    for (const day of daysToRead) {
      try {
        const det = report.getDetailedSpyState(day);
        if (!det) continue;
        const knownPlayerIds = det.getPlayerIDs() || [];
        const jobs = (det.getSpyJobs() || []).map((j) => ({
          day: j.getDay(),
          name: j.getName(),
          jobName: j.getJobName(),
          description: j.getDescription(),
          opponentId: j.getOpponentID(),
          provinceId: j.getProvinceID(),
          time: j.getTime(),
          amount: j.getAmount && j.getAmount(),
          premium: !!(j.isPremium && j.isPremium()),
          countryWide: !!(j.isCountryWide && j.isCountryWide()),
          mission: j.getMission && j.getMission(),
        }));
        const armies = ((det.getArmyState() && det.getArmyState().getArmiesArray()) || []).map(
          (a) => ({
            id: a.getArmyID(),
            owner: a.getOwnerID(),
            loc: a.getLocationID(),
            units: (a.getUnits() || []).map((u) => {
              const t = u.getEffectiveUnitType && u.getEffectiveUnitType();
              return { name: t && t.getName && t.getName(), size: u.getSize && u.getSize() };
            }),
          }),
        );
        const provincesByPlayer = {};
        for (const id of knownPlayerIds) {
          try {
            provincesByPlayer[id] = (det.getPlayerProvinces(id) || []).map((p) => p.getName && p.getName());
          } catch (e) {
            provincesByPlayer[id] = [];
          }
        }
        intel.push({ day, knownPlayerIds, jobs, armies, provincesByPlayer });
      } catch (e) {}
    }

    return {
      totals: {
        all: spy.getNumAllSpies(),
        idle: spy.getNumOfIdleSpies(),
        onMission: spy.getNumSpiesOnMission(),
        dailyCosts: spy.getDailyCosts(),
        dailyOnMission: spy.getDailyCostsOnMission(),
      },
      agents,
      currentDay,
      availableDays: days,
      latestIntel: intel[intel.length - 1],
      intel,
      knownCountryStats: dumpCountryStats(
        intel[intel.length - 1] && intel[intel.length - 1].knownPlayerIds,
      ),
    };
  }

  function exportSession(opts) {
    const includeSecrets = !!(opts && opts.secrets);
    const ud = hup.config.userData;
    return {
      gameServerUri: hup.userActionController.server.serverUri,
      client: hup.config.client,
      version: String(w.clientVersion || "293"),
      gameID: ud.gameID,
      playerID: ud.playerID,
      siteUserID: ud.siteUserID,
      userAuth: includeSecrets
        ? ud.userAuth
        : "[REDACTED — exportSession({secrets:true})]",
      tstamp: includeSecrets ? String(ud.tstamp) : "[REDACTED]",
      rights: ud.rights,
      adminLevel: ud.adminLevel,
    };
  }

  /**
   * Connect this game tab to the Node cabinet bridge (feat/ai-cabinet).
   * Default: ws://127.0.0.1:8765
   */
  function connectCabinetBridge(url, token) {
    const wsUrl = url || "ws://127.0.0.1:8765";
    let tok =
      token ||
      (typeof window !== "undefined" && window.__s1914BridgeToken) ||
      "";
    try {
      if (!tok && typeof localStorage !== "undefined") {
        tok = localStorage.getItem("s1914BridgeToken") || "";
      }
    } catch (e) {}
    try {
      const parsed = new URL(wsUrl);
      if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
        throw new Error("bridge URL must be 127.0.0.1 or localhost");
      }
      if (parsed.searchParams.get("token")) {
        tok = parsed.searchParams.get("token");
      }
    } catch (e) {
      if (e && e.message && e.message.indexOf("bridge URL") === 0) throw e;
    }
    if (!tok || String(tok).length < 8) {
      return fetch("http://127.0.0.1:9878/bridge-token?t=" + Date.now(), {
        cache: "no-store",
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then(function (t) {
          const got = String(t || "").trim();
          if (got.length < 8) throw new Error("empty token");
          return connectCabinetBridge(wsUrl, got);
        })
        .catch(function (e) {
          throw new Error(
            "connectCabinetBridge needs the token from npm run cabinet — " +
              (e && e.message ? e.message : e),
          );
        });
    }
    window.__s1914BridgeToken = tok;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("s1914BridgeToken", String(tok));
      }
    } catch (e) {}
    if (window.__s1914CabinetWs) {
      try {
        window.__s1914CabinetWs.close();
      } catch (e) {}
    }
    const ws = new WebSocket(wsUrl);
    window.__s1914CabinetWs = ws;

    function send(obj) {
      if (ws.readyState === 1) ws.send(JSON.stringify(obj));
    }

    function hello() {
      const ud = hup.config.userData;
      send({
        type: "hello",
        gameId: ud.gameID,
        playerId: ud.playerID,
        siteUserId: ud.siteUserID,
        token: tok,
      });
    }

    async function handleRequest(msg) {
      try {
        rebind();
      } catch (e) {
        throw new Error("game tab not ready — reload map and reconnect bridge");
      }
      const ud = hup.config.userData;
      try {
        if (msg.gameId != null && msg.gameId !== ud.gameID) {
          throw new Error(
            "gameId lock mismatch open=" + ud.gameID + " req=" + msg.gameId,
          );
        }
        const result = await dispatchBridgeMethod(msg.method, msg.args || {});
        send({
          type: "response",
          id: msg.id,
          ok: true,
          gameId: ud.gameID,
          result: result,
        });
      } catch (err) {
        send({
          type: "response",
          id: msg.id,
          ok: false,
          gameId: ud.gameID,
          error: err && err.message ? err.message : String(err),
        });
      }
    }

    async function dispatchBridgeMethod(method, args) {
      switch (method) {
        case "current_game":
          return currentGame();
        case "list_games":
          return listGames();
        case "use_game": {
          const gid =
            args.gameId != null
              ? Number(args.gameId)
              : args.index != null
                ? Number(args.index)
                : null;
          if (gid == null || Number.isNaN(gid)) {
            throw new Error("use_game needs gameId or index");
          }
          // Ensure cache is warm when switching by gameId.
          if (!window.s1914._gamesIndex || !window.s1914._gamesIndex.length) {
            await listGames();
          }
          return useGame(gid);
        }
        case "send_diplo": {
          const target = args.playerId != null ? args.playerId : args.name;
          if (target == null || !args.text) {
            throw new Error("send_diplo needs playerId|name and text");
          }
          return sendDiploMessage(target, String(args.text));
        }
        case "deploy_hero": {
          if (args.heroIdOrName == null || args.provinceIdOrName == null) {
            throw new Error("deploy_hero needs heroIdOrName and provinceIdOrName");
          }
          return deployHero(args.heroIdOrName, args.provinceIdOrName);
        }
        case "get_resources":
          return dumpResources();
        case "get_relations":
        case "get_diplomacy":
          return dumpDiplomacy();
        case "get_own_armies":
          return dumpOwnArmies();
        case "get_world_summary":
          return dumpWorldView({ summaryOnly: true, excludeSelf: false });
        case "get_messages":
          return dumpAllMessages();
        case "get_thread":
          if (args.playerId != null) return dumpRelatedWith(Number(args.playerId));
          if (args.name) return dumpRelatedByName(String(args.name));
          throw new Error("get_thread needs playerId or name");
        case "get_market":
          return dumpMarketOffers();
        case "get_spies":
          return dumpSpies();
        case "get_news":
          return dumpNews(args.day);
        case "get_heroes":
          return dumpHeroes();
        case "get_stats":
          return dumpAllStats();
        case "get_war_picture":
          return dumpWarPicture(args || {});
        case "get_finance_picture":
          return dumpFinanceProvinces();
        case "dump_finance_provinces":
          return dumpFinanceProvinces();
        case "dump_province_slots":
          return dumpProvinceSlots(args.provinceIdOrName);
        case "list_province_upgrades":
          return listProvinceUpgrades(args.provinceIdOrName);
        case "moveArmy":
          return moveArmy(Number(args.armyId), Number(args.x), Number(args.y), {
            append: !!args.append,
          });
        case "moveArmies":
          return moveArmies(
            args.armyIds || args.armyId,
            Number(args.x),
            Number(args.y),
            { append: !!args.append },
          );
        case "attackArmy":
          return attackArmy(Number(args.armyId), Number(args.targetArmyId));
        case "delayArmy":
          return delayArmy(
            Number(args.armyId),
            Number(args.minutes),
            !!args.syncArrival,
          );
        case "constructBuilding":
          return constructBuilding(args.provinceIdOrName, Number(args.upgradeId));
        case "writeNews":
          return writeNews(args.title, args.body, {
            anonymous: !!args.anonymous,
            imageData: args.imageData || null,
            imageName: args.imageName || null,
          });
        default:
          throw new Error("unknown bridge method: " + method);
      }
    }

    ws.onopen = function () {
      console.log("cabinet bridge connected", wsUrl);
      hello();
      if (window.__s1914CabinetHb) clearInterval(window.__s1914CabinetHb);
      window.__s1914CabinetHb = setInterval(function () {
        try {
          rebind();
        } catch (e) {}
        send({
          type: "heartbeat",
          gameId: hup.config.userData.gameID,
          t: Date.now(),
        });
      }, 10000);
    };
    ws.onmessage = function (ev) {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg && msg.type === "request") handleRequest(msg);
    };
    ws.onclose = function () {
      console.log("cabinet bridge closed");
      if (window.__s1914CabinetHb) clearInterval(window.__s1914CabinetHb);
    };
    ws.onerror = function (e) {
      console.warn("cabinet bridge error", e);
    };
    return { ok: true, url: wsUrl };
  }

  function findProvince(idOrName) {
    const map = hup.gameState.getMapState();
    if (typeof idOrName === "number" || /^\d+$/.test(String(idOrName).trim())) {
      const byId = map.getProvince(Number(idOrName));
      if (byId) return byId;
    }
    const needle = String(idOrName).trim().toLowerCase();
    if (!needle) return null;
    const self = hup.config.userData.playerID;
    // Prefer own provinces first (avoids wrong location ids / name collisions)
    const own = (map.getPlayerProvinces && map.getPlayerProvinces(self)) || [];
    const all = map.getProvinceArray ? map.getProvinceArray() : [];
    const pools = [own, all];
    for (let pi = 0; pi < pools.length; pi++) {
      const pool = pools[pi] || [];
      const hit = pool.find((p) => {
        const name = p.getName && p.getName();
        const id = p.getLocationID && p.getLocationID();
        return (
          (name && String(name).toLowerCase() === needle) ||
          String(id) === needle
        );
      });
      if (hit) return hit;
    }
    const partial = own.filter((p) => {
      const name = p.getName && p.getName();
      return (
        name &&
        (String(name).toLowerCase().includes(needle) ||
          needle.includes(String(name).toLowerCase()))
      );
    });
    return partial.length === 1 ? partial[0] : null;
  }

  function provinceIdOf(p) {
    if (p.getLocationID) return p.getLocationID();
    if (p.getProvinceID) return p.getProvinceID();
    return p.locationID != null ? p.locationID : p.id;
  }

  function dumpConstructionOptions(provinceIdOrName) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const pid = provinceIdOf(p);
    const packed = safeConstructionGroups(pid);
    return {
      provinceId: pid,
      name: p.getName && p.getName(),
      building: p.isBuilding && p.isBuilding(),
      producing: p.isProducing && p.isProducing(),
      clientError: packed.error,
      groups: packed.groups.map((g) => ({
        name: g.getName && g.getName(),
        items: (g.items || [])
          .map((it) => {
            let up = null;
            try {
              up = it.getUpgrade && it.getUpgrade();
            } catch (e) {
              return null;
            }
            if (!up) return null;
            return {
              name: it.getName && it.getName(),
              available: it.isAvailable && it.isAvailable(),
              upgradeId: up.getItemID ? up.getItemID() : up.itemID,
              condition: up.getCondition ? up.getCondition() : up.condition,
              wire: {
                "@c": "mu",
                c: up.getCondition ? up.getCondition() : up.condition,
                e: up.isEnabled ? up.isEnabled() : up.enabled,
                id: up.getItemID ? up.getItemID() : up.itemID,
                pl: up.getPremiumLevel ? up.getPremiumLevel() : up.premiumLevel,
                rp: up.getRelativePosition
                  ? up.getRelativePosition()
                  : up.relativePosition,
              },
            };
          })
          .filter(Boolean),
      })),
    };
  }

  function dumpProvinceSlots(provinceIdOrName) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const constructions = p.getConstructions ? p.getConstructions() : p.constructions;
    const productions = p.getProductions ? p.getProductions() : p.productions;
    const ser = (list) => {
      try {
        return JSON.parse(JSON.stringify(list || []));
      } catch (e) {
        return String(e);
      }
    };
    return {
      provinceId: provinceIdOf(p),
      name: p.getName && p.getName(),
      constructions: ser(constructions),
      productions: ser(productions),
      improvements: (p.getImprovementsBuilt
        ? p.getImprovementsBuilt()
        : p.improvements || []
      ).map((u) => ({
        id: u.getItemID ? u.getItemID() : u.itemID,
        name: u.getNameWithLevel
          ? u.getNameWithLevel()
          : u.getNameWithTier
            ? u.getNameWithTier()
            : null,
        condition: u.getCondition ? u.getCondition() : u.condition,
      })),
    };
  }

  function dumpProducibleUnits(provinceIdOrName, typeIds) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const ids =
      typeIds ||
      Object.keys(hup.contentItems)
        .map(Number)
        .filter((id) => {
          const it = hup.contentItems[id];
          return it && it.unitName && it.itemID;
        });
    const found = [];
    for (const tid of ids) {
      try {
        const poss = p.getPossibleProduction && p.getPossibleProduction(tid);
        const queue = p.getQueueableProduction && p.getQueueableProduction(tid);
        if (!poss && !queue) continue;
        const sample = poss || queue;
        const ut = sample.getUnit && sample.getUnit().getUnitType();
        found.push({
          unitTypeId: tid,
          name: (ut && ut.getName && ut.getName()) || (hup.contentItems[tid] && hup.contentItems[tid].unitName),
          canStart: !!poss,
          canQueue: !!queue,
          wire: JSON.parse(JSON.stringify(sample)),
          costs: ut && ut.getCosts && ut.getCosts(1),
        });
      } catch (e) {}
    }
    return {
      provinceId: provinceIdOf(p),
      name: p.getName && p.getName(),
      units: found,
    };
  }

  function normalizeUpgradeCosts(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (!row) continue;
        const id = Number(
          row.resourceId ?? row.id ?? row.resourceID ?? row[0],
        );
        const amt = Number(row.amount ?? row.cost ?? row[1]);
        if (Number.isFinite(id) && Number.isFinite(amt) && amt > 0) out[id] = amt;
      }
      return out;
    }
    for (const k of Object.keys(raw)) {
      const id = Number(k);
      const amt = Number(raw[k]);
      if (Number.isFinite(id) && Number.isFinite(amt) && amt > 0) out[id] = amt;
    }
    return out;
  }

  function upgradeCostsForItem(it, pid) {
    let costs = {};
    try {
      costs = normalizeUpgradeCosts(
        it.getRawProducibleCostsForProvinces &&
          it.getRawProducibleCostsForProvinces([pid]),
      );
    } catch (e) {}
    if (Object.keys(costs).length) return costs;
    try {
      costs = normalizeUpgradeCosts(it.getBaseCostRaw && it.getBaseCostRaw());
    } catch (e) {}
    if (Object.keys(costs).length) return costs;
    try {
      costs = normalizeUpgradeCosts(
        it.getSingleItemCosts && it.getSingleItemCosts(),
      );
    } catch (e) {}
    return costs;
  }

  function playerResourceStocks() {
    const stocks = [];
    let money = 0;
    try {
      const rs = hup.gameState.getResourceState();
      money =
        (rs.getPlayerMoneyAmount && rs.getPlayerMoneyAmount()) || 0;
      const ids = [];
      for (let i = 0; i <= 30; i++) ids.push(i);
      ids.push(20);
      const seen = {};
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (seen[id]) continue;
        seen[id] = true;
        try {
          const e = rs.getPlayerResourceEntry && rs.getPlayerResourceEntry(id);
          if (!e) continue;
          const amount = e.getAmount ? e.getAmount() : 0;
          stocks.push({ id: Number(id), amount: Number(amount) || 0 });
        } catch (e2) {}
      }
    } catch (e) {}
    return { money: Number(money) || 0, stocks: stocks };
  }

  function canAffordUpgradeCosts(costs) {
    const { money, stocks } = playerResourceStocks();
    const missing = [];
    for (const idStr of Object.keys(costs)) {
      const id = Number(idStr);
      const need = Number(costs[idStr]);
      if (!(need > 0)) continue;
      if (id === 20) {
        if (money < need) {
          missing.push({
            resourceId: 20,
            name: "Money",
            need: need,
            have: money,
          });
        }
        continue;
      }
      const row = stocks.find(function (s) {
        return s.id === id;
      });
      const have = row ? row.amount : 0;
      if (have < need) {
        missing.push({
          resourceId: id,
          name: "res#" + id,
          need: need,
          have: have,
        });
      }
    }
    return {
      ok: missing.length === 0,
      missing: missing,
      money: money,
      costs: costs,
    };
  }

  function readGroupItems(group) {
    let items = group && group.items;
    if (!items && group && typeof group.getItems === "function") {
      try {
        items = group.getItems();
      } catch (e) {
        items = [];
      }
    }
    if (!items && group && typeof group.getUpgrades === "function") {
      try {
        items = group.getUpgrades();
      } catch (e2) {
        items = [];
      }
    }
    return (items || []).filter(Boolean);
  }

  function normalizeConstructionGroups(raw) {
    return (raw || []).map(function (g) {
      const name =
        (g.getName && g.getName()) ||
        g.name ||
        g.title ||
        null;
      return {
        name: name,
        getName: function () {
          return name;
        },
        items: readGroupItems(g),
      };
    });
  }

  function callCatalogMethod(obj, name, pid) {
    const fn = obj && obj[name];
    if (typeof fn !== "function") return { missing: true };
    const argSets = [];
    if (fn.length === 0) argSets.push([]);
    argSets.push([[pid]]);
    argSets.push([pid]);
    let last = "no result";
    for (let i = 0; i < argSets.length; i++) {
      try {
        const value = fn.apply(obj, argSets[i]);
        const len = value && value.length != null ? value.length : null;
        return {
          ok: true,
          args: argSets[i].length,
          type: Array.isArray(value) ? "array" : value == null ? "null" : typeof value,
          len: len,
          value: value,
        };
      } catch (e) {
        last = e && e.message ? e.message : String(e);
      }
    }
    return { error: last };
  }

  /**
   * getConstructionGroups throws "reading 'getUpgrade'" when one catalog row is null.
   * Try that call first, then other get* construction methods, skipping null rows.
   */
  function safeConstructionGroups(pid) {
    const utils = hup.ProvinceProductionUtils;
    if (!utils || typeof utils.getConstructionGroups !== "function") {
      return { groups: [], error: "ProvinceProductionUtils unavailable", attempts: [] };
    }
    const attempts = [];
    try {
      const groups = utils.getConstructionGroups([pid]) || [];
      return { groups: normalizeConstructionGroups(groups), error: null, via: "getConstructionGroups", attempts: attempts };
    } catch (e) {
      attempts.push({
        method: "getConstructionGroups",
        error: e && e.message ? e.message : String(e),
      });
    }
    const names = methodNames(utils).filter(function (n) {
      return /^get/i.test(n) && /construct|upgrade|group|building/i.test(n) && n !== "getConstructionGroups";
    });
    for (let i = 0; i < names.length; i++) {
      const got = callCatalogMethod(utils, names[i], pid);
      if (got.missing) continue;
      if (got.error) {
        attempts.push({ method: names[i], error: String(got.error).slice(0, 180) });
        continue;
      }
      attempts.push({ method: names[i], type: got.type, len: got.len, args: got.args });
      if (Array.isArray(got.value) && got.value.length) {
        const groups = normalizeConstructionGroups(got.value);
        const withItems = groups.filter(function (g) {
          return g.items && g.items.length;
        });
        if (withItems.length) {
          return { groups: groups, error: null, via: names[i], attempts: attempts };
        }
      }
    }
    return {
      groups: [],
      error: attempts.length ? attempts[0].error : "construction catalog empty",
      via: null,
      attempts: attempts.slice(0, 12),
    };
  }

  function parseUpgradeCostString(raw) {
    const costs = {};
    String(raw || "")
      .split(",")
      .forEach(function (part) {
        const match = String(part).trim().match(/^a(\d+)=([0-9.]+)$/i);
        if (!match) return;
        const amount = Number(match[2]);
        if (amount > 0) costs[Number(match[1])] = amount;
      });
    return costs;
  }

  function nameUpgradeCosts(costs) {
    const named = {};
    let rs = null;
    try {
      rs = hup.gameState.getResourceState();
    } catch (e) {}
    Object.keys(costs || {}).forEach(function (id) {
      let label = "res#" + id;
      try {
        const rawName = rs && rs.getResourceName(Number(id));
        if (rawName && !/^none$/i.test(String(rawName))) label = String(rawName);
      } catch (eName) {}
      named[label] = costs[id];
    });
    return named;
  }

  /** Next-tier upgrades from contentItems when getConstructionGroups throws. */
  function contentUpgradeRows(p) {
    const built = {};
    const have = p.getImprovementsBuilt ? p.getImprovementsBuilt() : p.improvements || [];
    for (let i = 0; i < have.length; i++) {
      const id = have[i].getItemID ? have[i].getItemID() : have[i].itemID;
      if (id != null) built[String(id)] = true;
    }
    const morale = typeof p.getMorale === "function" ? p.getMorale() : null;
    const rows = [];
    const items = hup.contentItems || {};
    const keys = Object.keys(items);
    for (let i = 0; i < keys.length; i++) {
      const it = items[keys[i]];
      if (!it || typeof it.getUpgradeName !== "function" || it.buildTime == null) continue;
      if (it.unitName) continue;
      const id = Number(it.getItemID ? it.getItemID() : it.itemID);
      if (!Number.isFinite(id)) continue;
      if (built[String(id)]) continue;
      const replaced = Number(it.replacedUpgrade || 0);
      if (replaced && !built[String(replaced)]) continue;
      let level = 1;
      let cursor = replaced;
      const seen = {};
      while (cursor && items[cursor] && !seen[cursor] && level < 12) {
        seen[cursor] = true;
        level += 1;
        cursor = Number(items[cursor].replacedUpgrade || 0);
      }
      let costs = parseUpgradeCostString(it.costs);
      if (!Object.keys(costs).length) {
        try {
          costs = normalizeUpgradeCosts(it.getBuildCosts && it.getBuildCosts());
        } catch (eCost) {}
      }
      let daily = null;
      try {
        if (!it.hasDailyCosts || it.hasDailyCosts()) {
          const rawDaily = it.getDailyCosts && it.getDailyCosts();
          daily = rawDaily == null ? null : rawDaily;
        }
      } catch (eDaily) {
        daily = null;
      }
      const needCondition = Number(it.getBuildCondition ? it.getBuildCondition() : it.buildCondition);
      const conditionOk =
        !Number.isFinite(needCondition) || typeof morale !== "number" || morale >= needCondition;
      let required = [];
      try {
        const req = it.getRequiredUpgrades && it.getRequiredUpgrades();
        if (Array.isArray(req)) {
          required = req.map(function (u) {
            return u && (u.getItemID ? u.getItemID() : u.itemID || u);
          });
        }
      } catch (eReq) {}
      const requiredOk = required.every(function (rid) {
        return built[String(rid)];
      });
      const coastal = typeof p.isCoastal === "function" ? !!p.isCoastal() : !!p.coastal;
      const needsCoast = /harbour|harbor|port/i.test(String(it.articlePrefix || ""));
      const coastOk = !needsCoast || coastal;
      const afford = canAffordUpgradeCosts(costs);
      rows.push({
        upgradeId: id,
        name: it.getUpgradeName(),
        level: level,
        group: it.articlePrefix || null,
        costs: costs,
        costNames: nameUpgradeCosts(costs),
        dailyCosts: daily,
        moraleRequired: Number.isFinite(needCondition) ? needCondition : null,
        provinceMorale: typeof morale === "number" ? morale : null,
        conditionOk: conditionOk,
        coastalRequired: needsCoast,
        coastal: coastal,
        coastOk: coastOk,
        requiredUpgrades: required,
        requiredOk: requiredOk,
        affordable: afford.ok,
        missing: afford.missing,
        available: conditionOk && requiredOk && coastOk,
      });
    }
    rows.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name)) || a.level - b.level;
    });
    return rows;
  }

  function listProvinceUpgrades(provinceIdOrName) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found: " + provinceIdOrName);
    const pid = provinceIdOf(p);
    // Selecting the province often finishes view-model init before listing.
    try {
      if (hup.provinceController && hup.provinceController.selectProvinces) {
        hup.provinceController.selectProvinces([pid]);
      } else if (hup.provinceController && hup.provinceController.selectProvince) {
        hup.provinceController.selectProvince(pid);
      }
    } catch (eSel) {
      /* ignore */
    }
    const packed = safeConstructionGroups(pid);
    const upgrades = [];
    for (const g of packed.groups) {
      for (const it of g.items || []) {
        let up = null;
        try {
          up = it.getUpgrade && it.getUpgrade();
        } catch (eItem) {
          continue;
        }
        if (!up) continue;
        const id = up.getItemID ? up.getItemID() : up.itemID;
        if (id == null) continue;
        let costs = {};
        try {
          costs = upgradeCostsForItem(it, pid);
        } catch (eCost) {
          costs = {};
        }
        const moneyCost = Number(costs[20] || 0);
        const costNames = {};
        try {
          const rs = hup.gameState.getResourceState();
          Object.keys(costs).forEach(function (id) {
            let label = "res#" + id;
            try {
              label = rs.getResourceName(Number(id)) || label;
            } catch (eName) {}
            costNames[label] = costs[id];
          });
        } catch (eRs) {}
        upgrades.push({
          upgradeId: id,
          name:
            (it.getName && it.getName()) ||
            (up.getName && up.getName()) ||
            String(id),
          group: g.name || g.title || null,
          costs: costs,
          costNames: costNames,
          moneyCost: moneyCost,
          affordable: canAffordUpgradeCosts(costs).ok,
        });
      }
    }
    // Fallback: already-built improvements (ids useful for next-tier hints)
    const built = (
      p.getImprovementsBuilt
        ? p.getImprovementsBuilt()
        : p.improvements || []
    ).map(function (u) {
      return {
        upgradeId: u.getItemID ? u.getItemID() : u.itemID,
        name: u.getNameWithLevel
          ? u.getNameWithLevel()
          : u.getNameWithTier
            ? u.getNameWithTier()
            : u.getName
              ? u.getName()
              : null,
        built: true,
      };
    });
    let catalogVia = packed.via || null;
    if (!upgrades.length) {
      const fallback = contentUpgradeRows(p);
      for (let i = 0; i < fallback.length; i++) upgrades.push(fallback[i]);
      if (fallback.length) {
        catalogVia = "contentItems";
        packed.error = null;
      }
    }
    return {
      provinceId: pid,
      provinceName: p.getName ? p.getName() : String(provinceIdOrName),
      upgrades: upgrades,
      built: built,
      clientError: packed.error,
      catalogVia: catalogVia,
      catalogAttempts: upgrades.length ? [] : packed.attempts || [],
      note: packed.error
        ? "construction catalog failed in Ultimate client — use built[] + finance picture; retry or construct by known upgradeId"
        : catalogVia === "contentItems"
          ? "Listed from the client content catalog. available means the previous tier is built and the morale requirement is met. dailyCosts null means upkeep was not exposed."
          : null,
    };
  }

  function constructBuilding(provinceIdOrName, upgradeId) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const pid = provinceIdOf(p);
    try {
      if (hup.provinceController && hup.provinceController.selectProvinces) {
        hup.provinceController.selectProvinces([pid]);
      }
    } catch (eSel) {
      /* ignore */
    }
    const packed = safeConstructionGroups(pid);
    const groups = packed.groups;
    let item = null;
    let upgrade = null;
    const available = [];
    for (const g of groups) {
      for (const it of g.items || []) {
        let up = null;
        try {
          up = it.getUpgrade && it.getUpgrade();
        } catch (eUp) {
          continue;
        }
        const id = up && (up.getItemID ? up.getItemID() : up.itemID);
        const name =
          (it.getName && it.getName()) ||
          (up && up.getName && up.getName()) ||
          String(id);
        if (id != null) available.push({ upgradeId: id, name: name });
        if (id === upgradeId) {
          item = it;
          upgrade = up;
        }
      }
    }
    if (!upgrade) {
      const needle = String(upgradeId == null ? "" : upgradeId)
        .trim()
        .toLowerCase();
      if (needle && !/^\d+$/.test(needle)) {
        const named = [];
        for (const g of groups) {
          for (const it of g.items || []) {
            let up = null;
            try {
              up = it.getUpgrade && it.getUpgrade();
            } catch (eName) {
              continue;
            }
            const name = (
              (it.getName && it.getName()) ||
              (up && up.getName && up.getName()) ||
              ""
            )
              .toString()
              .toLowerCase();
            if (!name) continue;
            named.push({ it: it, up: up, name: name });
          }
        }
        const exact = named.filter(function (x) {
          return x.name === needle;
        });
        const partial = named.filter(function (x) {
          return (
            x.name.length >= 3 &&
            needle.length >= 3 &&
            (x.name.indexOf(needle) >= 0 || needle.indexOf(x.name) >= 0)
          );
        });
        const hits = exact.length ? exact : partial;
        if (hits.length === 1) {
          item = hits[0].it;
          upgrade = hits[0].up;
        } else if (hits.length > 1) {
          throw new Error(
            "upgrade name ambiguous (" +
              needle +
              ") — use exact upgradeId from listProvinceUpgrades",
          );
        }
      }
    }
    if (!upgrade) {
      const direct =
        hup.contentItems &&
        (hup.contentItems[upgradeId] || hup.contentItems[String(upgradeId)]);
      if (direct && typeof direct.getUpgradeName === "function") {
        upgrade = direct;
        item = direct;
      }
    }
    if (!upgrade) {
      const hint = available
        .slice(0, 20)
        .map(function (u) {
          return u.upgradeId + "=" + u.name;
        })
        .join(", ");
      throw new Error(
        "upgradeId " +
          upgradeId +
          " not available at " +
          (p.getName ? p.getName() : pid) +
          (hint ? " — available: " + hint : " — no upgrades listed"),
      );
    }
    const costs = upgradeCostsForItem(item, pid);
    if (!Object.keys(costs).length && item && item.getBuildCosts) {
      try {
        Object.assign(costs, normalizeUpgradeCosts(item.getBuildCosts()));
      } catch (eBuild) {}
    }
    if (!Object.keys(costs).length && item && item.costs) {
      Object.assign(costs, parseUpgradeCostString(item.costs));
    }
    const afford = canAffordUpgradeCosts(costs);
    if (!afford.ok) {
      const detail = afford.missing
        .map(function (m) {
          return m.name + " need " + m.need + " have " + Math.round(m.have);
        })
        .join("; ");
      throw new Error("not enough resources — " + detail);
    }
    hup.provinceController.constructBuilding([pid], upgrade, costs);
    return {
      ok: true,
      provinceId: pid,
      upgradeId: upgrade.getItemID ? upgrade.getItemID() : upgradeId,
      name: item.getName && item.getName(),
      costs: costs,
      moneyAfterEstimate: afford.money - Number(costs[20] || 0),
    };
  }

  function produceUnit(provinceIdOrName, unitTypeId) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const pid = provinceIdOf(p);
    const start = p.getPossibleProduction && p.getPossibleProduction(unitTypeId);
    const queue = p.getQueueableProduction && p.getQueueableProduction(unitTypeId);
    const su = start || queue;
    if (!su) {
      throw new Error(
        "unit type " + unitTypeId + " not producible/queueable in province " + pid,
      );
    }
    if (start) {
      hup.provinceController.produceUnit([pid], su);
      return { ok: true, mode: "start", provinceId: pid, unitTypeId };
    }
    hup.provinceController.addBuildQueueEntries([pid], su);
    return { ok: true, mode: "queue", provinceId: pid, unitTypeId };
  }

  function enqueueBuild(provinceIdOrName, upgradeId) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const pid = provinceIdOf(p);
    const packed = safeConstructionGroups(pid);
    const groups = packed.groups;
    if (packed.error && !groups.length) {
      throw new Error("construction catalog unavailable: " + packed.error);
    }
    let upgrade = null;
    for (const g of groups) {
      for (const it of g.items || []) {
        let up = null;
        try {
          up = it.getUpgrade && it.getUpgrade();
        } catch (eUp) {
          continue;
        }
        const id = up && (up.getItemID ? up.getItemID() : up.itemID);
        if (id === upgradeId) {
          upgrade = up;
          break;
        }
      }
      if (upgrade) break;
    }
    if (!upgrade) throw new Error("upgrade not found: " + upgradeId);
    hup.provinceController.addBuildQueueEntries([pid], upgrade);
    return { ok: true, provinceId: pid, upgradeId };
  }

  function cancelBuilding(provinceIdOrName, slot) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const pid = provinceIdOf(p);
    hup.provinceController.cancelBuilding([pid], slot || 0);
    return { ok: true, provinceId: pid, slot: slot || 0 };
  }

  function cancelUnitProduction(provinceIdOrName, slot) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const pid = provinceIdOf(p);
    hup.provinceController.cancelUnitProduction([pid], slot || 0);
    return { ok: true, provinceId: pid, slot: slot || 0 };
  }

  function webpackRequire() {
    let req = null;
    w.webpackChunksup_frontend.push([
      [Symbol("s1914")],
      {},
      function (r) {
        req = r;
      },
    ]);
    if (!req) throw new Error("webpack require unavailable");
    return req;
  }

  function gameCtors() {
    const req = webpackRequire();
    return {
      Order: req(55502).K,
      OrderAction: req(6039).M,
      ChangeRelation: req(71755).A,
      TradeOfferAction: req(40379).W,
      TradeOffer: req(29848)._,
      MessageAction: req(77464).f,
      Article: req(28384).S,
    };
  }

  function sendUserAction(action) {
    hup.userActionController.triggerAction(action);
    return { ok: true, cls: action["@c"] };
  }

  function dumpMarketOffers(resourceId, depth) {
    const sm = hup.ui.stockmarketController;
    try {
      sm.updateOfferLists && sm.updateOfferLists();
    } catch (e) {}
    const res = hup.gameState.getResourceState();
    const ids =
      resourceId != null
        ? [resourceId]
        : (sm.getTradeableResources() || [0, 1, 2, 3, 4, 5, 6]).map((t) =>
            typeof t === "object" && t && t.id != null ? Number(t.id) : Number(t),
          );
    const n = depth || 8;
    return ids.map((id) => {
      const buys = (sm.model.getBuyOffers(id, false, n) || []).map((o) => ({
        orderId: o.orderID || (o.getOrderID && o.getOrderID()),
        buy: o.buy ?? (o.isBuy && o.isBuy()),
        amount: o.amount || (o.getAmount && o.getAmount()),
        limit: o.limit || (o.getLimit && o.getLimit()),
        playerId: o.playerID,
        premium: o.isPremium && o.isPremium(),
        cls: o["@c"],
      }));
      const sells = (sm.model.getSellOffers(id, false, n) || []).map((o) => ({
        orderId: o.orderID || (o.getOrderID && o.getOrderID()),
        buy: o.buy ?? (o.isBuy && o.isBuy()),
        amount: o.amount || (o.getAmount && o.getAmount()),
        limit: o.limit || (o.getLimit && o.getLimit()),
        playerId: o.playerID,
        premium: o.isPremium && o.isPremium(),
        cls: o["@c"],
      }));
      const entry = res.getPlayerResourceEntry && res.getPlayerResourceEntry(id);
      return {
        resourceId: id,
        name: res.getResourceName(id),
        price: res.getPriceFor && res.getPriceFor(id),
        inventory: entry && entry.getAmount && entry.getAmount(),
        // client naming: buyOffers ≈ asks (you buy), sellOffers ≈ bids (you sell into)
        asks: buys.filter((o) => !o.premium),
        bids: sells.filter((o) => !o.premium),
      };
    });
  }

  function dumpMyOrders() {
    const sm = hup.ui.stockmarketController;
    try {
      sm.updateOfferLists && sm.updateOfferLists();
    } catch (e) {}
    return (sm.model.getResolvedCurrentOrders && sm.model.getResolvedCurrentOrders()) || [];
  }

  function placeMarketOrder(side, resourceId, amount, limit) {
    const { Order, OrderAction } = gameCtors();
    const pid = hup.config.userData.playerID;
    const isBuy = side === "buy" || side === true;
    const order = new Order(0, !!isBuy, amount, limit, resourceId, pid);
    return sendUserAction(new OrderAction(order, false));
  }

  function acceptMarketOrder(orderId, amount) {
    const { Order, OrderAction } = gameCtors();
    const book = hup.gameState.getResourceState().getOrder(orderId);
    if (!book) throw new Error("order not found: " + orderId);
    const pid = hup.config.userData.playerID;
    const counterparty = book.getPlayerID() === -1 ? -1 : pid;
    const fill = amount != null ? amount : book.getAmount();
    const order = new Order(
      book.getOrderID(),
      !book.isBuy(),
      fill,
      book.getLimit(),
      book.getResourceType(),
      counterparty,
    );
    return sendUserAction(new OrderAction(order, false));
  }

  function cancelMarketOrder(orderId) {
    const live = hup.gameState.getResourceState().getOrder(orderId);
    if (!live) throw new Error("order not found: " + orderId);
    hup.ui.stockmarketController.sendDeleteOrder(live);
    return { ok: true, orderId };
  }

  function findPlayer(idOrName) {
    if (typeof idOrName === "number") {
      return hup.gameState.getPlayerState().getPlayer(idOrName);
    }
    const raw = String(idOrName).toLowerCase().trim();
    const needle = raw
      .replace(/^(the)\s+/, "")
      .replace(/\s+(empire|kingdom|republic)$/, "")
      .trim();
    const players = hup.gameState.getPlayerState().getPlayersArray();
    const score = function (p) {
      const name = ((p.getName && p.getName()) || "").toLowerCase();
      const nation = ((p.getNationName && p.getNationName()) || "").toLowerCase();
      if (name === raw || nation === raw || name === needle || nation === needle)
        return 3;
      if (
        (nation && (nation.includes(needle) || needle.includes(nation))) ||
        (name && (name.includes(needle) || needle.includes(name)))
      )
        return 2;
      return 0;
    };
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < players.length; i++) {
      const s = score(players[i]);
      if (s > bestScore) {
        bestScore = s;
        best = players[i];
      }
    }
    return bestScore > 0 ? best : null;
  }

  function sendDiploMessage(playerIdOrName, text) {
    const { Article, MessageAction } = gameCtors();
    const self = hup.gameState
      .getPlayerState()
      .getPlayer(hup.config.userData.playerID);
    let receiverId = playerIdOrName;
    let receiverName = "";
    let allianceID = 0;
    if (typeof playerIdOrName === "string" || playerIdOrName > 0) {
      const p = findPlayer(playerIdOrName);
      if (!p) throw new Error("player not found");
      receiverId = p.getPlayerID();
      receiverName = p.getName && p.getName();
    } else if (playerIdOrName < -1000) {
      // alliance thread id e.g. -1005
      receiverId = playerIdOrName;
      allianceID = -1 * (playerIdOrName + 1000);
    }
    const art = new Article();
    art.setSenderID(hup.config.userData.playerID);
    art.setReceiverID(receiverId);
    art.setReceiverName(receiverName || "");
    art.setMessageBody(text);
    art.setAuthorID(self.getPlayerID());
    art.setAuthor(self.getFullName && self.getFullName());
    art.setDateObj(new Date());
    if (allianceID) art.allianceID = allianceID;
    const action = new MessageAction();
    action.setNewArticles([art]);
    return sendUserAction(action);
  }

  function setRelation(playerIdOrName, relation) {
    const { ChangeRelation } = gameCtors();
    const p = findPlayer(playerIdOrName);
    if (!p) throw new Error("player not found");
    const rel = typeof relation === "number" ? relation : Number(relation);
    return sendUserAction(new ChangeRelation([p.getPlayerID()], [rel]));
  }

  function createTradeOffer(playerIdOrName, offerA, offerB, message) {
    const { TradeOffer, TradeOfferAction } = gameCtors();
    const p = findPlayer(playerIdOrName);
    if (!p) throw new Error("player not found");
    const offer = new TradeOffer(
      hup.config.userData.playerID,
      p.getPlayerID(),
      offerA,
      offerB,
      message || "",
      Date.now(),
      true,
    );
    const sendable = offer.toSendable ? offer.toSendable() : offer;
    const action = new TradeOfferAction();
    action.initNewOffer(sendable);
    return sendUserAction(action);
  }

  function respondTradeOffer(tradeId, actionName) {
    const { TradeOfferAction } = gameCtors();
    const flagMap = {
      accept: TradeOfferAction.ACCEPT_OFFER,
      refuse: TradeOfferAction.REFUSE_OFFER,
      delete: TradeOfferAction.DELETE_OFFER,
      read: TradeOfferAction.READ_OFFER,
    };
    const flag = flagMap[String(actionName).toLowerCase()];
    if (flag == null) throw new Error("action must be accept|refuse|delete|read");
    const action = new TradeOfferAction();
    action.initResponse(tradeId, flag);
    return sendUserAction(action);
  }

  function dumpOpenTradeOffers() {
    const trading = hup.gameState.getResourceState().getTrading();
    const pid = hup.config.userData.playerID;
    const offers = trading.tradingOffers || [];
    return offers.map((o) => ({
      tradeId: o.getTradeID(),
      from: o.getPartyA(),
      to: o.getPartyB(),
      mine: o.getPartyA() === pid || o.getPartyB() === pid,
      offerA: o.getOffersAAsString && o.getOffersAAsString(),
      offerB: o.getOffersBAsString && o.getOffersBAsString(),
      offerAType: o.getOfferAType && o.getOfferAType(),
      offerBType: o.getOfferBType && o.getOfferBType(),
      message: o.message || "",
      processed: o.isProcessed && o.isProcessed(),
    }));
  }

  function dumpHeroes() {
    const hsm = hup.heroSystemManager;
    if (!hsm) throw new Error("heroSystemManager missing (hero system disabled?)");
    const raw = hsm.getHeroItems() || [];
    const items = (Array.isArray(raw) ? raw : Object.values(raw)).map((it) => {
      const cfg = it.getHeroConfig && it.getHeroConfig();
      const ut = it.getUnitType && it.getUnitType();
      const obtained = !!(it.isObtained && it.isObtained());
      const deployed = !!(it.isDeployed && it.isDeployed());
      const onCooldown = !!(it.isHeroDeploymentOnCooldown && it.isHeroDeploymentOnCooldown());
      const locked = !!(it.isLocked && it.isLocked());
      // Scenario day gate (e.g. Allenby day 2, Callahan day 1)
      const dayOfAvailability =
        it.getDayOfAvailability && it.getDayOfAvailability();
      const dayReached = !!(
        it.isDayOfAvailabilityReached && it.isDayOfAvailabilityReached()
      );
      const canDeploy =
        obtained &&
        !deployed &&
        !onCooldown &&
        !locked &&
        dayReached;
      return {
        itemId: it.itemID || (it.getItemID && it.getItemID()),
        name: cfg && cfg.getName && cfg.getName(),
        shortName: cfg && cfg.getShortName && cfg.getShortName(),
        level: it.getCurrentLevel && it.getCurrentLevel(),
        rarity: it.getRarity && it.getRarity(),
        unitTypeId: (ut && ut.getItemID && ut.getItemID()) || it.baseUnitTypeId || null,
        obtained,
        deployed,
        onCooldown,
        cooldownSeconds: (it.getHeroRecoveryCooldown && it.getHeroRecoveryCooldown()) || 0,
        limitReached: !!(it.isHeroLimitReached && it.isHeroLimitReached()),
        locked,
        dayOfAvailability: dayOfAvailability != null ? dayOfAvailability : null,
        dayReached,
        moraleThreshold: it.deploymentMoraleThreshold,
        canDeploy,
      };
    });
    const obtained = items.filter((h) => h.obtained);
    const pid = hup.config.userData.playerID;
    const map = hup.gameState.getMapState();
    const deployedOnMap = hup.gameState
      .getArmyState()
      .getArmiesArray()
      .filter((a) => a.getOwnerID() === pid)
      .map((a) => {
        const heroes = (a.getUnits() || [])
          .map((u) => {
            const t = u.getEffectiveUnitType && u.getEffectiveUnitType();
            const typeId = t && t.getItemID && t.getItemID();
            if (typeId == null) return null;
            const hi = hsm.getHeroUnitItemByUnitTypeId && hsm.getHeroUnitItemByUnitTypeId(typeId);
            if (!hi) return null;
            const cfg = hi.getHeroConfig && hi.getHeroConfig();
            const inv = items.find(
              (h) => h.unitTypeId === typeId || h.itemId === (hi.itemID || (hi.getItemID && hi.getItemID())),
            );
            return {
              unitTypeId: typeId,
              name: cfg && cfg.getName && cfg.getName(),
              shortName: cfg && cfg.getShortName && cfg.getShortName(),
              level: inv && inv.level,
              rarity: inv && inv.rarity,
              cooldownSeconds: inv && inv.cooldownSeconds,
            };
          })
          .filter(Boolean);
        if (!heroes.length) return null;
        const pos = a.getPosition();
        const prov = map.getProvinceAt(pos);
        return {
          armyId: a.getArmyID(),
          province: prov && prov.getName && prov.getName(),
          provinceId: prov && (prov.getLocationID ? prov.getLocationID() : prov.locationID),
          pos: { x: pos.x, y: pos.y },
          heroes,
        };
      })
      .filter(Boolean);

    return {
      maxDeployed: hsm.getMaxHeroLimitForCurrentScenario(),
      deployedCount: hsm.getDeployedHeroAmountForActiveGame(),
      inventory: obtained,
      deployed: obtained.filter((h) => h.deployed),
      deployable: obtained.filter((h) => h.canDeploy),
      onCooldown: obtained.filter((h) => h.onCooldown),
      deployedOnMap,
    };
  }

  function findHero(idOrName) {
    const snap = dumpHeroes();
    if (typeof idOrName === "number") {
      return snap.inventory.find((h) => h.itemId === idOrName || h.unitTypeId === idOrName);
    }
    const needle = String(idOrName).toLowerCase();
    return snap.inventory.find(
      (h) =>
        (h.shortName && h.shortName.toLowerCase() === needle) ||
        (h.name && h.name.toLowerCase().includes(needle)),
    );
  }

  function deployHero(heroIdOrName, provinceIdOrName) {
    const hero = findHero(heroIdOrName);
    if (!hero) throw new Error("hero not found in inventory");
    if (!hero.canDeploy) {
      throw new Error(
        "hero not deployable (deployed=" +
          hero.deployed +
          " cooldown=" +
          hero.onCooldown +
          " locked=" +
          hero.locked +
          " dayReached=" +
          hero.dayReached +
          " availableFromDay=" +
          hero.dayOfAvailability +
          ")",
      );
    }
    if (hero.limitReached) {
      console.warn(
        "hero limit reached (" +
          dumpHeroes().deployedCount +
          "/" +
          dumpHeroes().maxDeployed +
          ") — deploy may be rejected",
      );
    }
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const provinceId = provinceIdOf(p);
    const req = webpackRequire();
    const UsePremiumAction = req(172).z;
    const action = new UsePremiumAction(hero.itemId, 1, { provinces: [provinceId] });
    return Object.assign(sendUserAction(action), {
      hero: hero.shortName || hero.name,
      itemId: hero.itemId,
      provinceId,
      province: p.getName && p.getName(),
    });
  }

  function dumpNews(day, opts) {
    const ns = hup.gameState.getNewspaperState();
    const currentDay = hup.gameState.getGameInfoState().getDayOfGame();
    const target = day != null ? day : currentDay;
    if (!ns.hasDay(target)) {
      try {
        ns.requestDay(target);
      } catch (e) {}
    }
    if (!ns.hasDay(target)) {
      return {
        ok: false,
        currentDay,
        requestedDay: target,
        loadedDays: Object.keys(ns.days || {}).map(Number),
        note: "day not loaded yet — call dumpNews(day) again after state update",
      };
    }
    const raw = (ns.getArticlesSorted && ns.getArticlesSorted(target)) || ns.getArticles(target) || [];
    const onlyPlayer = opts && opts.onlyPlayer;
    const articles = raw
      .map((a) => {
        const authorID = a.getAuthorID && a.getAuthorID();
        let kind = "other";
        if (authorID > 0) kind = "player";
        else if (authorID === -2) kind = "system_battle";
        else if (authorID === -3) kind = "system_stats";
        else if (authorID === -1) kind = "anonymous";
        return {
          uid: a.getMessageUID && a.getMessageUID(),
          title: a.getTitle && a.getTitle(),
          body: a.getMessageBody && a.getMessageBody(),
          author: a.getAuthor && a.getAuthor(),
          authorID,
          senderID: a.getSenderID && a.getSenderID(),
          day: a.getDay && a.getDay(),
          timeStamp: a.getTimeStamp && a.getTimeStamp(),
          kind,
        };
      })
      .filter((a) => (onlyPlayer ? a.kind === "player" : true));

    return {
      ok: true,
      currentDay,
      day: target,
      loadedDays: Object.keys(ns.days || {}).map(Number).sort((a, b) => a - b),
      unread: ns.getNewArticlesCount(hup.config.userData.playerID, 0),
      counts: {
        all: articles.length,
        player: articles.filter((a) => a.kind === "player").length,
        system_battle: articles.filter((a) => a.kind === "system_battle").length,
        system_stats: articles.filter((a) => a.kind === "system_stats").length,
      },
      articles,
    };
  }

  function writeNews(title, body, options) {
    if (!title || !body) throw new Error("title and body required");
    const t = String(title).trim();
    const b = String(body).trim();
    if (!t || !b) throw new Error("title and body required");
    const req = webpackRequire();
    const Article = req(28384).S;
    const NewArticleAction = req(10243).I;
    const profile = hup.gameState.getPlayerProfile();
    const art = new Article();
    const anonymous = !!(options && options.anonymous);
    art.updateArticle(profile, t, b, anonymous);
    const imageData = (options && options.imageData) || null;
    const imageName = (options && options.imageName) || null;
    const action = new NewArticleAction(art, imageData, imageName);
    return new Promise(function (resolve, reject) {
      let settled = false;
      const finish = function (payload) {
        if (settled) return;
        settled = true;
        resolve(payload);
      };
      const fail = function (err) {
        if (settled) return;
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      try {
        hup.userActionController.triggerActionWithOptions(action, {
          onSuccess: function () {
            console.log("newspaper article published");
            finish({
              ok: true,
              verified: true,
              title: t,
              bodyPreview: b.slice(0, 120),
              anonymous,
            });
          },
          onFailure: function (err) {
            fail(
              err && err.message
                ? err
                : new Error(String(err || "writeNews failed")),
            );
          },
        });
      } catch (err) {
        fail(err);
        return;
      }
      // Game client sometimes omits callbacks — treat quiet accept as ok.
      setTimeout(function () {
        finish({
          ok: true,
          verified: true,
          title: t,
          bodyPreview: b.slice(0, 120),
          anonymous,
          pendingAck: true,
        });
      }, 2500);
    });
  }

  function dumpWorldView(opts) {
    opts = opts || {};
    const gs = hup.gameState;
    const map = gs.getMapState();
    const armyState = gs.getArmyState();
    const players = gs.getPlayerState();
    const fa = gs.getForeignAffairsState();
    const rel = fa.getRelations();
    const self = hup.config.userData.playerID;
    const onlyVisible = !!opts.onlyVisible;
    const ownerFilter =
      opts.ownerId != null
        ? opts.ownerId
        : opts.owner
          ? (findPlayer(opts.owner) || {}).getPlayerID &&
            findPlayer(opts.owner).getPlayerID()
          : null;
    const excludeSelf = !!opts.excludeSelf;
    const includeProvinces = opts.provinces !== false;
    const includeArmies = opts.armies !== false;
    const summaryOnly = !!opts.summaryOnly;

    const playerName = (id) => {
      const p = players.getPlayer(id);
      return {
        name: p && p.getName && p.getName(),
        nation: p && p.getNationName && p.getNationName(),
      };
    };

    let rawArmies = onlyVisible
      ? armyState.getVisibleArmies() || []
      : armyState.getArmiesArray() || [];

    const armies = includeArmies
      ? rawArmies
          .filter((a) => {
            const o = a.getOwnerID();
            if (ownerFilter != null && o !== ownerFilter) return false;
            if (excludeSelf && o === self) return false;
            return true;
          })
          .map((a) => {
            const pos = a.getPosition();
            const prov = map.getProvinceAt(pos);
            const details = a.isDetailsVisible ? a.isDetailsVisible() : true;
            const units = details
              ? (a.getUnits() || []).map((u) => {
                  const t = u.getEffectiveUnitType && u.getEffectiveUnitType();
                  return {
                    name: t && t.getName && t.getName(),
                    size: u.getSize && u.getSize(),
                    typeId: (t && t.getItemID && t.getItemID()) || (u.getTypeID && u.getTypeID()),
                  };
                })
              : [];
            const ref = playerName(a.getOwnerID());
            return {
              id: a.getArmyID(),
              ownerId: a.getOwnerID(),
              owner: ref.name,
              nation: ref.nation,
              province: prov && prov.getName && prov.getName(),
              locationId: a.getLocationID(),
              pos: { x: pos.x, y: pos.y },
              onSea: a.isOnSea && a.isOnSea(),
              detailsVisible: details,
              units,
              morale: a.getVisibleMorale ? a.getVisibleMorale() : a.morale,
              spyRevealed: a.getSpyRevealedTime && a.getSpyRevealedTime(),
              ...mapArmyRuntime(a),
            };
          })
      : [];

    const provinces = includeProvinces
      ? (map.getProvinceArray() || [])
          .filter((p) => {
            const o = p.getOwnerID();
            if (ownerFilter != null && o !== ownerFilter) return false;
            if (excludeSelf && o === self) return false;
            return true;
          })
          .map((p) => {
            const o = p.getOwnerID();
            const ref = playerName(o);
            const cap = p.getCapital ? p.getCapital() : p.capital;
            return {
              id: p.getLocationID(),
              name: p.getName(),
              ownerId: o,
              owner: ref.name,
              nation: ref.nation,
              morale: p.getMorale && p.getMorale(),
              coastal: p.isCoastal ? p.isCoastal() : !!p.coastal,
              unknownUpgrades: p.getUnknownUpgradesCount && p.getUnknownUpgradesCount(),
              visibleUpgrades: (p.getVisibleUpgrades && p.getVisibleUpgrades() || []).length,
              stationaryArmyId: p.getStationaryArmyID && p.getStationaryArmyID(),
              capital: cap ? { x: cap.x, y: cap.y } : null,
            };
          })
      : [];

    const byCountry = {};
    for (const p of provinces) {
      if (p.ownerId <= 0) continue;
      if (!byCountry[p.ownerId]) {
        byCountry[p.ownerId] = {
          playerId: p.ownerId,
          name: p.owner,
          nation: p.nation,
          provinces: 0,
          armies: 0,
          detailed: 0,
          fogged: 0,
          relation: p.ownerId === self ? null : rel.getRelation(self, p.ownerId),
        };
      }
      byCountry[p.ownerId].provinces += 1;
    }
    for (const a of armies) {
      if (a.ownerId <= 0) continue;
      if (!byCountry[a.ownerId]) {
        byCountry[a.ownerId] = {
          playerId: a.ownerId,
          name: a.owner,
          nation: a.nation,
          provinces: 0,
          armies: 0,
          detailed: 0,
          fogged: 0,
          relation: a.ownerId === self ? null : rel.getRelation(self, a.ownerId),
        };
      }
      byCountry[a.ownerId].armies += 1;
      if (a.detailsVisible) byCountry[a.ownerId].detailed += 1;
      else byCountry[a.ownerId].fogged += 1;
    }

    const countries = Object.values(byCountry).sort(
      (a, b) => b.provinces - a.provinces || b.armies - a.armies,
    );

    const out = {
      self,
      mapSize: { w: map.getWidth && map.getWidth(), h: map.getHeight && map.getHeight() },
      totals: {
        provinces: provinces.length,
        armies: armies.length,
        visibleArmies: (armyState.getVisibleArmies && armyState.getVisibleArmies() || []).length,
        allKnownArmies: (armyState.getArmiesArray() || []).length,
        detailedForeign: armies.filter((a) => a.ownerId !== self && a.detailsVisible).length,
        foggedForeign: armies.filter((a) => a.ownerId !== self && !a.detailsVisible).length,
      },
      countries,
    };
    if (!summaryOnly) {
      out.provinces = provinces;
      out.armies = armies;
    }
    return out;
  }

  function dumpCountryForces(ownerIdOrName) {
    const p = findPlayer(ownerIdOrName);
    if (!p) throw new Error("player not found");
    return dumpWorldView({
      ownerId: p.getPlayerID(),
      excludeSelf: false,
    });
  }

  /**
   * Compressed war picture for cabinet War Minister + 5-min watch.
   * Caps foreign armies; includes borders, diplo, spies, heroes, identity lock.
   */
  function dumpWarPicture(opts) {
    opts = opts || {};
    const maxForeign = opts.maxForeign != null ? opts.maxForeign : 80;
    const cg = currentGame();
    const ud = hup.config.userData;
    const gs = hup.gameState;
    const players = gs.getPlayerState();
    const me = players.getPlayer(ud.playerID);
    const myNation =
      (me && me.getNationName && me.getNationName()) ||
      (me && me.getName && me.getName()) ||
      "self";

    const world = dumpWorldView({
      summaryOnly: false,
      excludeSelf: false,
      provinces: true,
      armies: true,
    });
    const diplo = dumpDiplomacy();
    let spies = null;
    try {
      spies = dumpSpies(false);
    } catch (e) {
      spies = { error: String(e && e.message ? e.message : e) };
    }
    let heroes = null;
    try {
      heroes = dumpHeroes();
    } catch (e) {
      heroes = { error: String(e && e.message ? e.message : e) };
    }
    let financeById = {};
    try {
      const fin = dumpFinanceProvinces();
      const list = (fin && fin.provinces) || [];
      for (let i = 0; i < list.length; i++) {
        financeById[list[i].id] = list[i];
      }
    } catch (e) {}

    const selfId = ud.playerID;
    const ownProvinces = (world.provinces || []).filter((p) => p.ownerId === selfId);
    const foreignProvinces = (world.provinces || []).filter(
      (p) => p.ownerId > 0 && p.ownerId !== selfId,
    );
    const ownArmies = (world.armies || []).filter((a) => a.ownerId === selfId);
    const foreignArmiesAll = (world.armies || []).filter((a) => a.ownerId !== selfId);

    function dist(a, b) {
      if (!a || !b || a.x == null || b.x == null) return Infinity;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function armyPos(a) {
      return a && a.pos ? a.pos : null;
    }
    function provPos(p) {
      return p && p.capital ? p.capital : null;
    }

    // Median own–own province spacing for border band.
    const ownDists = [];
    for (let i = 0; i < ownProvinces.length; i++) {
      for (let j = i + 1; j < ownProvinces.length; j++) {
        const d = dist(provPos(ownProvinces[i]), provPos(ownProvinces[j]));
        if (Number.isFinite(d) && d > 0) ownDists.push(d);
      }
    }
    ownDists.sort((a, b) => a - b);
    const medianSpacing =
      ownDists.length > 0
        ? ownDists[Math.floor(ownDists.length / 2)]
        : 50;
    const borderBand = medianSpacing * 1.5;

    const borders = [];
    for (const op of ownProvinces) {
      let best = null;
      let bestD = Infinity;
      for (const fp of foreignProvinces) {
        const d = dist(provPos(op), provPos(fp));
        if (d < bestD) {
          bestD = d;
          best = fp;
        }
      }
      if (best && bestD <= borderBand) {
        const relRow = (diplo.nonPeace || [])
          .concat(diplo.atWar || [])
          .find((r) => r.id === best.ownerId);
        borders.push({
          province: op.name,
          provinceId: op.id,
          morale: op.morale,
          coastal: !!op.coastal,
          facingNation: best.nation || best.owner,
          facingPlayerId: best.ownerId,
          facingProvince: best.name,
          distance: Math.round(bestD * 100) / 100,
          relation: relRow ? relRow.relation : null,
          relationLabel: relRow ? relRow.label : null,
          atWar: !!(relRow && relRow.war),
        });
      }
    }

    const atWarLive = diplo.atWar || [];
    const atWarIds = new Set(atWarLive.map((r) => r.id));
    const countryById = {};
    for (const c of world.countries || []) {
      countryById[c.playerId] = c;
    }

    function warStatusFor(playerId, diploRow) {
      const c = countryById[playerId];
      const provs = c ? c.provinces || 0 : 0;
      const armies = c ? c.armies || 0 : 0;
      const defeated = !!(diploRow && diploRow.defeated);
      let retired = false;
      try {
        const pl = players.getPlayer(playerId);
        retired = !!(pl && pl.isRetired && pl.isRetired());
      } catch (e) {}
      if (defeated || retired) return { status: "defeated", provs, armies, defeated: true };
      if (provs <= 0 && armies <= 0) return { status: "ghost", provs, armies, defeated: false };
      // Tiny remnant: still on map but not a real front unless bordering us
      if (provs + armies <= 2) return { status: "dormant", provs, armies, defeated: false };
      return { status: "active", provs, armies, defeated: false };
    }

    const atWarEnriched = atWarLive.map((r) => {
      const st = warStatusFor(r.id, r);
      return {
        ...r,
        provincesKnown: st.provs,
        armiesKnown: st.armies,
        status: st.status,
        defeated: st.defeated || !!r.defeated,
      };
    });
    const atWarActive = atWarEnriched.filter((r) => r.status === "active" || r.status === "dormant");
    const atWarPaper = [
      ...(diplo.atWarDefeated || []).map((r) => ({
        ...r,
        status: "defeated",
        defeated: true,
        provincesKnown: 0,
        armiesKnown: 0,
      })),
      ...atWarEnriched.filter((r) => r.status === "ghost" || r.status === "defeated"),
    ];

    const ownCentroid = (() => {
      if (!ownArmies.length && !ownProvinces.length) return { x: 0, y: 0 };
      const pts = ownArmies.length
        ? ownArmies.map(armyPos).filter(Boolean)
        : ownProvinces.map(provPos).filter(Boolean);
      if (!pts.length) return { x: 0, y: 0 };
      let sx = 0;
      let sy = 0;
      for (const p of pts) {
        sx += p.x;
        sy += p.y;
      }
      return { x: sx / pts.length, y: sy / pts.length };
    })();

    const scoredForeign = foreignArmiesAll.map((a) => {
      const dSelf = dist(armyPos(a), ownCentroid);
      let dBorder = Infinity;
      for (const b of borders) {
        if (b.facingPlayerId === a.ownerId) {
          const bp = ownProvinces.find((p) => p.id === b.provinceId);
          const dd = dist(armyPos(a), provPos(bp));
          if (dd < dBorder) dBorder = dd;
        }
      }
      const warBonus = atWarIds.has(a.ownerId) ? 0 : 1;
      const near = Math.min(dSelf, dBorder);
      return { a, near, warBonus, dSelf, dBorder };
    });
    scoredForeign.sort((x, y) => {
      if (x.warBonus !== y.warBonus) return x.warBonus - y.warBonus;
      return x.near - y.near;
    });
    const foreignArmies = scoredForeign.slice(0, maxForeign).map((s) => ({
      ...s.a,
      distToSelf: Math.round(s.dSelf * 100) / 100,
      distToBorder: Number.isFinite(s.dBorder)
        ? Math.round(s.dBorder * 100) / 100
        : null,
      atWar: atWarIds.has(s.a.ownerId),
    }));

    // Coarse fronts by facing playerId — only real neighbors; score by live war + contact.
    const frontMap = {};
    for (const b of borders) {
      const key = String(b.facingPlayerId);
      const row = atWarEnriched.find((r) => r.id === b.facingPlayerId);
      const st = warStatusFor(b.facingPlayerId, row);
      if (st.status === "defeated" || st.status === "ghost") continue;
      if (!frontMap[key]) {
        const liveWar = atWarIds.has(b.facingPlayerId) && st.status === "active";
        frontMap[key] = {
          name: b.facingNation || key,
          playerId: b.facingPlayerId,
          level: liveWar ? "high" : "medium",
          relation: b.relationLabel,
          atWar: !!b.atWar && st.status !== "defeated",
          status: st.status,
          provincesKnown: st.provs,
          armiesKnown: st.armies,
          borderProvinces: [],
          ownArmyIds: [],
          hostileArmyIds: [],
          nearestHostile: null,
        };
      }
      frontMap[key].borderProvinces.push(b.province);
    }
    for (const a of ownArmies) {
      let bestKey = null;
      let bestD = Infinity;
      for (const b of borders) {
        const bp = ownProvinces.find((p) => p.id === b.provinceId);
        const d = dist(armyPos(a), provPos(bp));
        if (d < bestD) {
          bestD = d;
          bestKey = String(b.facingPlayerId);
        }
      }
      if (bestKey && frontMap[bestKey] && bestD <= borderBand * 2) {
        frontMap[bestKey].ownArmyIds.push(a.id);
      }
    }
    for (const a of foreignArmies) {
      const key = String(a.ownerId);
      if (!frontMap[key]) continue;
      frontMap[key].hostileArmyIds.push(a.id);
      const d = a.distToBorder != null ? a.distToBorder : a.distToSelf;
      if (
        !frontMap[key].nearestHostile ||
        d < frontMap[key].nearestHostile.distance
      ) {
        frontMap[key].nearestHostile = {
          armyId: a.id,
          province: a.province,
          distance: d,
          onSea: !!a.onSea,
        };
      }
    }
    const armyById = {};
    for (const a of ownArmies.concat(foreignArmies)) armyById[a.id] = a;
    function stackStrength(ids) {
      let n = 0;
      for (let i = 0; i < ids.length; i++) {
        const a = armyById[ids[i]];
        const units = a && a.units;
        if (!units || !units.length) {
          n += 1;
          continue;
        }
        for (let j = 0; j < units.length; j++) n += Number(units[j].size) || 0;
      }
      return n;
    }
    const fronts = Object.values(frontMap).map((f) => {
      const hasContact =
        f.ownArmyIds.length > 0 ||
        f.hostileArmyIds.length > 0 ||
        f.borderProvinces.length > 0;
      let level = f.level;
      if (f.status === "dormant" && !f.hostileArmyIds.length) level = "low";
      if (f.atWar && f.status === "active" && hasContact) level = "high";
      if (!f.atWar && !f.hostileArmyIds.length) level = "low";
      const ownIds = [...new Set(f.ownArmyIds)];
      const hostIds = [...new Set(f.hostileArmyIds)].slice(0, 20);
      return {
        ...f,
        level,
        borderProvinces: [...new Set(f.borderProvinces)].slice(0, 12),
        ownArmyIds: ownIds,
        hostileArmyIds: hostIds,
        ownStrength: stackStrength(ownIds),
        hostileStrength: stackStrength(hostIds),
      };
    });

    const spyAgents = (spies && spies.agents) || [];
    const coveredOwners = new Set(
      spyAgents.map((s) => s.provinceOwner).filter((x) => x != null),
    );
    const fog = atWarActive
      .filter((r) => r.status === "active" && !coveredOwners.has(r.id))
      .map((r) => ({ playerId: r.id, nation: r.nation || r.name, reason: "no_spy_coverage" }));

    const sensorDegraded =
      (ownArmies.length === 0 && foreignArmiesAll.length === 0) ||
      (ownProvinces.length === 0 && (world.provinces || []).length === 0);

    let coalitionName = null;
    try {
      const coal = me.getCoalition && me.getCoalition();
      if (coal) coalitionName = coal.getName ? coal.getName() : String(coal);
    } catch (e) {}
    const allRows = (diplo.nonPeace || []).concat(diplo.atWar || []);
    const coalitionMembers = coalitionName
      ? allRows.filter((r) => r.coalition === coalitionName)
      : [];

    return {
      takenAt: new Date().toISOString(),
      gameId: cg.gameId,
      myPlayerId: selfId,
      myNation,
      day: cg.day,
      timeScale: cg.timeScale,
      mapSize: world.mapSize,
      medianSpacing: Math.round(medianSpacing * 100) / 100,
      borderBand: Math.round(borderBand * 100) / 100,
      sensorDegraded,
      diplo: {
        atWar: atWarActive,
        atWarPaper: atWarPaper,
        ceasefire: (diplo.nonPeace || []).filter(
          (r) => r.relation === -1 && !r.defeated,
        ),
        embargo: (diplo.nonPeace || []).filter(
          (r) => r.relation === 0 && !r.defeated,
        ),
        nap: (diplo.nonPeace || []).filter((r) => r.relation === 2 && !r.defeated),
        rightOfWay: diplo.rightOfWay || [],
        shareMapOrBetter: diplo.shareMapOrBetter || [],
        enemies: diplo.enemies,
        allies: diplo.allies,
        coalitionName: coalitionName,
        coalitionMembers: coalitionMembers,
      },
      ownArmies: ownArmies.map((a) => {
        const cmdCount =
          a.commandCount != null
            ? a.commandCount
            : Array.isArray(a.commands)
              ? a.commands.length
              : Number(a.commands) || 0;
        return {
          id: a.id,
          province: a.province,
          pos: a.pos,
          onSea: !!a.onSea,
          units: a.units,
          commands: Array.isArray(a.commands) ? a.commands : cmdCount,
          commandCount: cmdCount,
          waitSeconds: a.waitSeconds,
          speed: a.speed,
          currentSpeed: a.currentSpeed,
          forcedMarch: a.forcedMarch,
          range: a.range,
          idle: cmdCount <= 0,
          morale: a.morale,
        };
      }),
      ownProvinces: ownProvinces.map((p) => {
        const extra = financeById[p.id] || {};
        return {
          id: p.id,
          name: p.name,
          capital: provPos(p),
          morale: extra.morale != null ? extra.morale : p.morale,
          coastal: extra.coastal != null ? extra.coastal : !!p.coastal,
          unknownUpgradeCount: p.unknownUpgrades,
          visibleUpgradeCount: p.visibleUpgrades,
          stationaryArmyId: p.stationaryArmyId,
          improvements: extra.buildings,
          revoltChance: extra.revoltChance,
          mainProduction: extra.mainProduction,
        };
      }),
      foreignArmies,
      borders: borders.slice(0, 60),
      fronts,
      spies: {
        totals: spies && spies.totals,
        agents: spyAgents.slice(0, 40),
        latestIntel: spies && spies.latestIntel
          ? {
              day: spies.latestIntel.day,
              armyCount: (spies.latestIntel.armies || []).length,
              jobs: (spies.latestIntel.jobs || []).slice(0, 15),
              knownPlayerIds: spies.latestIntel.knownPlayerIds,
            }
          : null,
        fog,
      },
      heroes: heroes && !heroes.error
        ? {
            deployedOnMap: (heroes.deployedOnMap || []).slice(0, 30),
            inventory: (heroes.inventory || []).slice(0, 20),
          }
        : heroes,
      totals: {
        ownArmies: ownArmies.length,
        foreignVisible: foreignArmiesAll.length,
        foreignCapped: foreignArmies.length,
        ownProvinces: ownProvinces.length,
        borders: borders.length,
        fronts: fronts.length,
        atWar: atWarActive.length,
        atWarPaper: atWarPaper.length,
      },
    };
  }

  function zoomLevel(zoom) {
    if (typeof zoom === "number" && Number.isFinite(zoom)) return zoom;
    const z = String(zoom || "mid").toLowerCase();
    if (z === "far") return 0.35;
    if (z === "near") return 1.4;
    return 0.75;
  }

  /**
   * Pan/zoom Ultimate map camera to map coords (or province/army).
   * Prefers native camera APIs; fails clearly if none work.
   */
  function centerMap(args) {
    args = args || {};
    let x = args.x != null ? Number(args.x) : null;
    let y = args.y != null ? Number(args.y) : null;
    let caption = args.label != null ? String(args.label) : null;
    const zoom = zoomLevel(args.zoom);
    let focusedVia = null;

    if ((x == null || y == null || Number.isNaN(x) || Number.isNaN(y)) && args.armyId != null) {
      const army = hup.gameState.getArmyState().getArmy(Number(args.armyId));
      if (!army) throw new Error("army not found: " + args.armyId);
      const pos = army.getPosition && army.getPosition();
      if (!pos) throw new Error("army has no position: " + args.armyId);
      x = pos.getX ? pos.getX() : pos.x;
      y = pos.getY ? pos.getY() : pos.y;
      if (!caption) caption = "army " + args.armyId;
      try {
        if (hup.armyController && typeof hup.armyController.selectArmy === "function") {
          hup.armyController.selectArmy(Number(args.armyId));
          focusedVia = "armyController.selectArmy";
        } else if (hup.armyController && typeof hup.armyController.selectArmies === "function") {
          hup.armyController.selectArmies([Number(args.armyId)]);
          focusedVia = "armyController.selectArmies";
        }
      } catch (eArm) {
        /* ignore */
      }
    }

    if ((x == null || y == null || Number.isNaN(x) || Number.isNaN(y)) && args.provinceIdOrName != null) {
      const p = findProvince(args.provinceIdOrName);
      if (!p) throw new Error("province not found: " + args.provinceIdOrName);
      const cap =
        (p.getCapital && p.getCapital()) ||
        (p.getPosition && p.getPosition()) ||
        null;
      if (!cap) throw new Error("province has no capital coords");
      x = cap.getX ? cap.getX() : cap.x;
      y = cap.getY ? cap.getY() : cap.y;
      if (!caption) caption = (p.getName && p.getName()) || String(args.provinceIdOrName);
      try {
        if (hup.provinceController && hup.provinceController.selectProvinces) {
          hup.provinceController.selectProvinces([provinceIdOf(p)]);
          focusedVia = "provinceController.selectProvinces";
        } else if (hup.provinceController && hup.provinceController.selectProvince) {
          hup.provinceController.selectProvince(provinceIdOf(p));
          focusedVia = "provinceController.selectProvince";
        }
      } catch (eSel) {
        /* ignore */
      }
    }

    if (x == null || y == null || Number.isNaN(x) || Number.isNaN(y)) {
      throw new Error("center_map needs x+y, provinceIdOrName, or armyId");
    }

    const tried = [];
    const attempts = [
      function () {
        const c = hup.mapController;
        if (!c) return false;
        if (typeof c.centerOn === "function") {
          c.centerOn(x, y);
          if (typeof c.setZoom === "function") c.setZoom(zoom);
          return true;
        }
        if (typeof c.scrollTo === "function") {
          c.scrollTo(x, y);
          if (typeof c.setZoom === "function") c.setZoom(zoom);
          return true;
        }
        if (typeof c.setCenter === "function") {
          c.setCenter(x, y);
          if (typeof c.setZoom === "function") c.setZoom(zoom);
          return true;
        }
        return false;
      },
      function () {
        const c = hup.camera || hup.mapCamera;
        if (!c) return false;
        if (typeof c.setPosition === "function") {
          c.setPosition(x, y);
          if (typeof c.setZoom === "function") c.setZoom(zoom);
          return true;
        }
        if (typeof c.lookAt === "function") {
          c.lookAt(x, y);
          return true;
        }
        return false;
      },
      function () {
        const v = hup.gameView || hup.mapView || hup.view;
        if (!v) return false;
        if (typeof v.centerAt === "function") {
          v.centerAt(x, y);
          return true;
        }
        if (typeof v.setCenter === "function") {
          v.setCenter(x, y);
          return true;
        }
        if (typeof v.scrollTo === "function") {
          v.scrollTo(x, y);
          return true;
        }
        return false;
      },
      function () {
        const r = hup.renderer || hup.mapRenderer;
        if (r && typeof r.centerOn === "function") {
          r.centerOn(x, y);
          return true;
        }
        if (hup.scrollHandler && typeof hup.scrollHandler.scrollTo === "function") {
          hup.scrollHandler.scrollTo(x, y);
          return true;
        }
        return false;
      },
      function () {
        // Ultimate often exposes scroll on UI / world map helpers
        const ui = hup.ui || hup.UI || hup.gameUI;
        if (ui && typeof ui.centerMapOn === "function") {
          ui.centerMapOn(x, y);
          return true;
        }
        if (typeof hup.centerMapOn === "function") {
          hup.centerMapOn(x, y);
          return true;
        }
        if (typeof hup.scrollToPosition === "function") {
          hup.scrollToPosition(x, y);
          return true;
        }
        return false;
      },
    ];

    let ok = false;
    for (let i = 0; i < attempts.length; i++) {
      try {
        if (attempts[i]()) {
          ok = true;
          tried.push("ok#" + i);
          break;
        }
        tried.push("miss#" + i);
      } catch (e) {
        tried.push("err#" + i + ":" + (e && e.message ? e.message : String(e)));
      }
    }

    // Province/army select usually pans the Ultimate map even without a camera API.
    if (!ok && focusedVia) {
      ok = true;
      tried.push("fallback:" + focusedVia);
    }
    // Still allow screenshot of current viewport when coords resolved but camera APIs missing.
    if (!ok && x != null && y != null) {
      ok = true;
      tried.push("fallback:coords-only-no-camera");
    }

    if (!ok) {
      throw new Error(
        "center_map: no native camera API found on hup (mapController/camera/gameView). Tried: " +
          tried.join(", "),
      );
    }

    return {
      ok: true,
      x: x,
      y: y,
      zoom: args.zoom || "mid",
      zoomValue: zoom,
      caption: caption,
      focusedVia: focusedVia,
      tried: tried,
    };
  }

  function builtUpgradeOnProvince(p, upgradeIdOrName) {
    const list = p.getImprovementsBuilt
      ? p.getImprovementsBuilt()
      : p.improvements || [];
    const needle =
      upgradeIdOrName == null ? "" : String(upgradeIdOrName).trim().toLowerCase();
    const wantId =
      typeof upgradeIdOrName === "number" || /^\d+$/.test(needle)
        ? Number(upgradeIdOrName)
        : null;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      const id = u.getItemID ? u.getItemID() : u.itemID;
      const name = u.getNameWithLevel
        ? u.getNameWithLevel()
        : u.getNameWithTier
          ? u.getNameWithTier()
          : u.getName
            ? u.getName()
            : "";
      if (wantId != null && Number(id) === wantId) return { up: u, id: Number(id), name: name };
      if (
        wantId == null &&
        needle &&
        name &&
        (String(name).toLowerCase() === needle ||
          String(name).toLowerCase().indexOf(needle) >= 0)
      ) {
        return { up: u, id: Number(id), name: name };
      }
    }
    return null;
  }

  function upgradeEnabledFlag(up) {
    if (!up) return null;
    if (typeof up.isEnabled === "function") return !!up.isEnabled();
    if (up.enabled != null) return !!up.enabled;
    if (up.e != null) return !!up.e;
    return null;
  }

  function upgradeCondition(up) {
    if (!up) return 0;
    if (typeof up.getCondition === "function") return Number(up.getCondition()) || 0;
    if (up.condition != null) return Number(up.condition) || 0;
    if (up.c != null) return Number(up.c) || 0;
    return 0;
  }

  function upgradePremiumLevel(up) {
    if (!up) return 0;
    if (typeof up.getPremiumLevel === "function") return Number(up.getPremiumLevel()) || 0;
    if (up.premiumLevel != null) return Number(up.premiumLevel) || 0;
    if (up.pl != null) return Number(up.pl) || 0;
    return 0;
  }

  /** Submit UltUpdateProvinceAction mode=0 with mu.e flip (HAR-confirmed). */
  function sendProvinceUpgradeEnabled(provinceIds, upgradeWire) {
    const pc = hup.provinceController;
    const ids = provinceIds.slice();
    const tried = [];

    const methodTries = [
      "setUpgradeEnabled",
      "setBuildingEnabled",
      "enableUpgrade",
      "disableUpgrade",
      "toggleUpgrade",
      "updateUpgrade",
      "updateProvinceUpgrade",
      "changeUpgrade",
      "updateProvince",
      "activateBuilding",
      "deactivateBuilding",
    ];
    for (let i = 0; i < methodTries.length; i++) {
      const name = methodTries[i];
      if (!pc || typeof pc[name] !== "function") continue;
      try {
        // Common signatures
        pc[name](ids, upgradeWire);
        tried.push(name + ":ok");
        return { ok: true, via: name, tried: tried };
      } catch (e1) {
        try {
          pc[name](ids, upgradeWire.id, upgradeWire.e);
          tried.push(name + ":ok2");
          return { ok: true, via: name + "/id", tried: tried };
        } catch (e2) {
          tried.push(
            name +
              ":fail:" +
              (e1 && e1.message ? e1.message : String(e1)),
          );
        }
      }
    }

    // Build wire action and send through client channels used by Ultimate
    const action = {
      requestID: "actionReq-" + Date.now(),
      "@c": "ultshared.action.UltUpdateProvinceAction",
      provinceIDs: ids,
      slot: 0,
      mode: 0,
      upgrade: upgradeWire,
    };

    const senders = [
      function () {
        if (hup.gameClient && typeof hup.gameClient.sendActions === "function") {
          hup.gameClient.sendActions([action]);
          return "gameClient.sendActions";
        }
        return null;
      },
      function () {
        if (hup.gameClient && typeof hup.gameClient.sendAction === "function") {
          hup.gameClient.sendAction(action);
          return "gameClient.sendAction";
        }
        return null;
      },
      function () {
        if (typeof hup.sendActions === "function") {
          hup.sendActions([action]);
          return "hup.sendActions";
        }
        return null;
      },
      function () {
        if (hup.client && typeof hup.client.sendUpdateGameStateAction === "function") {
          hup.client.sendUpdateGameStateAction([action]);
          return "client.sendUpdateGameStateAction";
        }
        return null;
      },
      function () {
        // Some builds hang actions off armyController's connection
        const ac = hup.armyController;
        if (ac && typeof ac.sendCustomAction === "function") {
          ac.sendCustomAction(action);
          return "armyController.sendCustomAction";
        }
        return null;
      },
      function () {
        // Last resort: provinceController may expose raw action send
        if (pc && typeof pc.sendAction === "function") {
          pc.sendAction(action);
          return "provinceController.sendAction";
        }
        if (pc && typeof pc.sendActions === "function") {
          pc.sendActions([action]);
          return "provinceController.sendActions";
        }
        return null;
      },
    ];

    for (let s = 0; s < senders.length; s++) {
      try {
        const via = senders[s]();
        if (via) {
          tried.push(via);
          return { ok: true, via: via, tried: tried };
        }
      } catch (e) {
        tried.push("sender" + s + ":" + (e && e.message ? e.message : String(e)));
      }
    }

    throw new Error(
      "set_building_enabled: no provinceController/client sender for mode-0 upgrade toggle. Tried: " +
        tried.join(" | "),
    );
  }

  function setBuildingEnabled(provinceIdOrName, upgradeIdOrName, enabled) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found: " + provinceIdOrName);
    if (upgradeIdOrName == null || upgradeIdOrName === "") {
      throw new Error("set_building_enabled needs upgradeId or upgradeName");
    }
    const hit = builtUpgradeOnProvince(p, upgradeIdOrName);
    if (!hit) {
      throw new Error(
        "building not built in province: " +
          (p.getName && p.getName()) +
          " / " +
          upgradeIdOrName,
      );
    }
    const before = upgradeEnabledFlag(hit.up);
    const cond = upgradeCondition(hit.up);
    const pl = upgradePremiumLevel(hit.up);
    const wire = {
      "@c": "mu",
      c: cond,
      e: !!enabled,
      rp: null,
      id: hit.id,
      pl: pl,
    };
    const pid = provinceIdOf(p);
    const sent = sendProvinceUpgradeEnabled([pid], wire);

    // Re-read
    let after = null;
    try {
      const again = builtUpgradeOnProvince(p, hit.id);
      after = again ? upgradeEnabledFlag(again.up) : null;
    } catch (eR) {
      after = null;
    }

    return {
      ok: true,
      provinceId: pid,
      provinceName: p.getName ? p.getName() : String(provinceIdOrName),
      upgradeId: hit.id,
      upgradeName: hit.name,
      enabled: !!enabled,
      before: before,
      after: after,
      via: sent.via,
    };
  }

  function bulkSetBuildingEnabled(args) {
    args = args || {};
    const enabled = !!args.enabled;
    const upgradeKey =
      args.upgradeId != null
        ? args.upgradeId
        : args.upgradeName != null
          ? args.upgradeName
          : null;
    if (upgradeKey == null || upgradeKey === "") {
      throw new Error("bulk_set_building_enabled needs upgradeId or upgradeName");
    }

    const map = hup.gameState.getMapState();
    const self = hup.config.userData.playerID;
    let targets = [];
    if (Array.isArray(args.provinceIds) && args.provinceIds.length) {
      targets = args.provinceIds.map(Number).filter(function (n) {
        return Number.isFinite(n);
      });
    } else {
      const own = (map.getPlayerProvinces && map.getPlayerProvinces(self)) || [];
      for (let i = 0; i < own.length; i++) {
        const p = own[i];
        if (builtUpgradeOnProvince(p, upgradeKey)) {
          targets.push(provinceIdOf(p));
        }
      }
    }

    const updated = [];
    const skipped = [];
    // Prefer one multi-id send when possible (HAR allows provinceIDs array)
    if (targets.length > 1) {
      try {
        const sample = findProvince(targets[0]);
        const hit = sample && builtUpgradeOnProvince(sample, upgradeKey);
        if (hit) {
          const wire = {
            "@c": "mu",
            c: upgradeCondition(hit.up),
            e: enabled,
            rp: null,
            id: hit.id,
            pl: upgradePremiumLevel(hit.up),
          };
          const beforeMap = {};
          for (let t = 0; t < targets.length; t++) {
            const pp = findProvince(targets[t]);
            const hh = pp && builtUpgradeOnProvince(pp, upgradeKey);
            if (!hh) {
              skipped.push({ provinceId: targets[t], reason: "not_built" });
              continue;
            }
            beforeMap[targets[t]] = {
              name: pp.getName ? pp.getName() : String(targets[t]),
              before: upgradeEnabledFlag(hh.up),
              upgradeId: hh.id,
              upgradeName: hh.name,
            };
          }
          const ids = Object.keys(beforeMap).map(Number);
          if (ids.length) {
            sendProvinceUpgradeEnabled(ids, wire);
            for (let j = 0; j < ids.length; j++) {
              const pp2 = findProvince(ids[j]);
              const hh2 = pp2 && builtUpgradeOnProvince(pp2, wire.id);
              updated.push({
                provinceId: ids[j],
                name: beforeMap[ids[j]].name,
                upgradeId: beforeMap[ids[j]].upgradeId,
                upgradeName: beforeMap[ids[j]].upgradeName,
                before: beforeMap[ids[j]].before,
                after: hh2 ? upgradeEnabledFlag(hh2.up) : null,
              });
            }
            return {
              ok: true,
              upgradeId: hit.id,
              enabled: enabled,
              updated: updated,
              skipped: skipped,
              mode: "bulk",
            };
          }
        }
      } catch (eBulk) {
        // fall through to per-province
      }
    }

    for (let k = 0; k < targets.length; k++) {
      try {
        const row = setBuildingEnabled(targets[k], upgradeKey, enabled);
        updated.push({
          provinceId: row.provinceId,
          name: row.provinceName,
          upgradeId: row.upgradeId,
          upgradeName: row.upgradeName,
          before: row.before,
          after: row.after,
        });
      } catch (eOne) {
        skipped.push({
          provinceId: targets[k],
          reason: eOne && eOne.message ? eOne.message : String(eOne),
        });
      }
    }

    return {
      ok: true,
      upgradeId:
        updated[0] && updated[0].upgradeId != null
          ? updated[0].upgradeId
          : typeof upgradeKey === "number"
            ? upgradeKey
            : null,
      enabled: enabled,
      updated: updated,
      skipped: skipped,
      mode: "loop",
    };
  }

  function ownerOfProvince(p) {
    let playerId = null;
    try {
      playerId = p.getOwnerID ? p.getOwnerID() : p.ownerID;
    } catch (e) {}
    let name = null;
    try {
      const pl = hup.gameState.getPlayerState().getPlayer(playerId);
      name = pl && pl.getName ? pl.getName() : null;
    } catch (e) {}
    return { playerId: playerId, name: name };
  }

  function capitalXY(p) {
    const cap = p.getCapital ? p.getCapital() : p.capital;
    if (!cap) return null;
    const x = Number(cap.x != null ? cap.x : cap.getX && cap.getX());
    const y = Number(cap.y != null ? cap.y : cap.getY && cap.getY());
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: x, y: y };
  }

  function methodNames(obj) {
    const names = [];
    const seen = {};
    let o = obj;
    let depth = 0;
    while (o && o !== Object.prototype && depth < 6) {
      let keys = [];
      try {
        keys = Object.getOwnPropertyNames(o);
      } catch (e) {
        keys = [];
      }
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (seen[k] || k === "constructor") continue;
        seen[k] = true;
        try {
          if (typeof o[k] === "function") names.push(k);
        } catch (e2) {}
      }
      o = Object.getPrototypeOf(o);
      depth++;
    }
    return names;
  }

  function neighborCards(p) {
    const map = hup.gameState.getMapState();
    const selfId = provinceIdOf(p);
    const direct =
      (typeof p.getNeighbours === "function" && p.getNeighbours()) ||
      (typeof p.getNeighbors === "function" && p.getNeighbors()) ||
      null;
    if (direct && direct.length) {
      return {
        approximate: false,
        neighbors: direct.map(function (n) {
          const owner = ownerOfProvince(n);
          return {
            id: provinceIdOf(n),
            name: n.getName && n.getName(),
            owner: owner,
          };
        }),
      };
    }
    const cap = capitalXY(p);
    const all = map.getProvinceArray ? map.getProvinceArray() : [];
    const scored = [];
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (!o || provinceIdOf(o) === selfId) continue;
      const oc = capitalXY(o);
      if (!cap || !oc) continue;
      scored.push({
        d: Math.hypot(oc.x - cap.x, oc.y - cap.y),
        o: o,
      });
    }
    scored.sort(function (a, b) {
      return a.d - b.d;
    });
    return {
      approximate: true,
      note: "client has no neighbour graph; nearest capitals by distance",
      neighbors: scored.slice(0, 6).map(function (row) {
        return {
          id: provinceIdOf(row.o),
          name: row.o.getName && row.o.getName(),
          owner: ownerOfProvince(row.o),
          capitalDistance: Math.round(row.d),
        };
      }),
    };
  }

  function resolvePoint(x, y) {
    const map = hup.gameState.getMapState();
    const arr = map.getProvinceArray ? map.getProvinceArray() : [];
    let Point = null;
    for (let i = 0; i < arr.length && !Point; i++) {
      const c = arr[i].getCapital && arr[i].getCapital();
      if (c && c.constructor) Point = c.constructor;
    }
    if (Point) return new Point(Number(x), Number(y));
    return { x: Number(x), y: Number(y) };
  }

  function inspectProvince(args) {
    rebind();
    args = args || {};
    const map = hup.gameState.getMapState();
    if (!map) throw new Error("mapState not ready");
    let p = null;
    if (args.x != null && args.y != null) {
      const pt = resolvePoint(args.x, args.y);
      p = map.getProvinceAt(pt);
    } else if (args.provinceIdOrName != null) {
      p = findProvince(args.provinceIdOrName);
    } else {
      throw new Error("inspect_province needs provinceIdOrName or x,y");
    }
    if (!p) throw new Error("province not found");
    const self = hup.config.userData.playerID;
    const owner = ownerOfProvince(p);
    const id = provinceIdOf(p);
    let buildings = null;
    let resourceType = null;
    let mainProduction = null;
    if (owner.playerId === self) {
      const fin = dumpFinanceProvinces();
      const row = (fin.provinces || []).find(function (r) {
        return r.id === id;
      });
      buildings = row ? row.buildings : [];
      resourceType = row ? row.resourceType : null;
      mainProduction = row ? row.mainProduction : null;
    } else {
      buildings = {
        fog: true,
        note: "foreign building detail hidden by fog of war",
      };
    }
    const near = neighborCards(p);
    return {
      id: id,
      name: p.getName && p.getName(),
      capital: capitalXY(p),
      owner: owner,
      morale: p.getMorale ? p.getMorale() : null,
      coastal: p.isCoastal ? p.isCoastal() : !!p.coastal,
      resourceType: resourceType,
      mainProduction: mainProduction,
      buildings: buildings,
      neighbors: near.neighbors,
      neighborsApproximate: near.approximate,
      neighborsNote: near.note || null,
    };
  }

  function ownArmy(armyId) {
    const army = hup.gameState.getArmyState().getArmy(Number(armyId));
    if (!army) throw new Error("army not found");
    if (army.getOwnerID() !== hup.config.userData.playerID) {
      throw new Error("army " + armyId + " is not yours");
    }
    return army;
  }

  async function stopArmy(armyId) {
    rebind();
    const army = ownArmy(armyId);
    const before = (army.getCommands() || []).length;
    if (before === 0) {
      return { ok: true, armyId: Number(armyId), alreadyStopped: true, commands: 0 };
    }
    const tried = [];
    const armyMethods = [
      "clearCommands",
      "removeAllCommands",
      "deleteCommands",
      "cancelCommands",
      "stop",
      "clearCommandQueue",
    ];
    for (let i = 0; i < armyMethods.length; i++) {
      const name = armyMethods[i];
      if (typeof army[name] === "function") {
        tried.push("army." + name);
        try {
          army[name]();
        } catch (e) {
          tried.push(name + ":" + (e && e.message ? e.message : e));
        }
      }
    }
    try {
      hup.armySelection.setSelected([army]);
    } catch (e) {}
    const ac = hup.mapMouseController && hup.mapMouseController.armyController;
    if (ac) {
      const names = methodNames(ac).filter(function (n) {
        return /stop|cancel|clear/i.test(n);
      });
      for (let j = 0; j < names.length; j++) {
        tried.push("ac." + names[j]);
        try {
          ac[names[j]]();
        } catch (e2) {}
      }
    }
    await new Promise(function (r) {
      setTimeout(r, 250);
    });
    rebind();
    const afterArmy = hup.gameState.getArmyState().getArmy(Number(armyId));
    const after = afterArmy ? (afterArmy.getCommands() || []).length : before;
    if (after < before) {
      return {
        ok: true,
        armyId: Number(armyId),
        commandsBefore: before,
        commandsAfter: after,
        tried: tried,
      };
    }
    const discovered = methodNames(army).slice(0, 40);
    throw new Error(
      "stop_army: command queue unchanged (" +
        before +
        "). tried=" +
        tried.join(",") +
        " armyMethods=" +
        discovered.join(","),
    );
  }

  async function splitArmy(armyId, units) {
    rebind();
    const army = ownArmy(armyId);
    const list = Array.isArray(units) ? units : [];
    if (!list.length) throw new Error("split_army needs units[]");
    const beforeIds = (hup.gameState.getArmyState().getArmiesArray() || [])
      .filter(function (a) {
        return a.getOwnerID() === hup.config.userData.playerID;
      })
      .map(function (a) {
        return a.getArmyID();
      });
    const armySplit = methodNames(army).filter(function (n) {
      return /split|peel|detach|transfer/i.test(n);
    });
    const ac = hup.mapMouseController && hup.mapMouseController.armyController;
    const acSplit = ac
      ? methodNames(ac).filter(function (n) {
          return /split|peel|detach|transfer/i.test(n);
        })
      : [];
    const tried = [];
    try {
      hup.armySelection.setSelected([army]);
    } catch (e) {}
    function callMaybe(obj, name) {
      if (!obj || typeof obj[name] !== "function") return;
      tried.push(name);
      try {
        obj[name](list);
      } catch (e1) {
        try {
          obj[name](army, list);
        } catch (e2) {
          tried.push(name + ":" + (e2 && e2.message ? e2.message : e2));
        }
      }
    }
    for (let i = 0; i < armySplit.length; i++) callMaybe(army, armySplit[i]);
    for (let j = 0; j < acSplit.length; j++) callMaybe(ac, acSplit[j]);
    await new Promise(function (r) {
      setTimeout(r, 400);
    });
    rebind();
    const afterIds = (hup.gameState.getArmyState().getArmiesArray() || [])
      .filter(function (a) {
        return a.getOwnerID() === hup.config.userData.playerID;
      })
      .map(function (a) {
        return a.getArmyID();
      });
    const created = afterIds.filter(function (id) {
      return beforeIds.indexOf(id) < 0;
    });
    if (created.length) {
      return {
        ok: true,
        keptArmyId: Number(armyId),
        newArmyId: created[0],
        newArmyIds: created,
        tried: tried,
      };
    }
    throw new Error(
      "split_army: no new stack. splitMethods=" +
        armySplit.concat(acSplit).join(",") +
        " armyMethods=" +
        methodNames(army).slice(0, 40).join(","),
    );
  }

  function relationNote(ownerId) {
    if (ownerId == null) return null;
    const self = hup.config.userData.playerID;
    if (ownerId === self) return "own territory";
    try {
      const dip = dumpDiplomacy();
      const rows = dip.relations || dip.players || dip.entries || [];
      const hit = (rows || []).find(function (r) {
        return r && (r.playerId === ownerId || r.id === ownerId);
      });
      if (!hit) return "no relation row (fog or unmet)";
      return hit.relation || hit.status || hit.state || hit;
    } catch (e) {
      return null;
    }
  }

  async function previewArmyOrder(args) {
    rebind();
    args = args || {};
    const army = ownArmy(args.armyId);
    const mode = String(args.mode || "move");
    let x = args.x != null ? Number(args.x) : null;
    let y = args.y != null ? Number(args.y) : null;
    if ((x == null || y == null) && args.provinceIdOrName != null) {
      const prov = findProvince(args.provinceIdOrName);
      if (!prov) throw new Error("province not found");
      const cap = capitalXY(prov);
      if (!cap) throw new Error("province has no capital coords");
      x = cap.x;
      y = cap.y;
    }
    if (x == null || y == null) throw new Error("preview needs x,y or provinceIdOrName");
    const onSea = !!(army.isOnSea && army.isOnSea());
    const start = army.getPosition();
    const target = hup.gameState
      .getMapState()
      .closestMapPoint(resolvePoint(x, y), onSea);
    try {
      hup.armySelection.setSelected([]);
    } catch (e) {}
    hup.armySelection.setSelected([army]);
    const ac = hup.mapMouseController.armyController;
    if (mode === "attack" && typeof ac.setCommandMode === "function") {
      ac.setCommandMode(2);
    } else {
      ac.updateMoveSelection();
      ac.setCommandMode(0);
    }
    ac.setDragTarget(target, null);
    const valid = !!ac.isValidCommand;
    const reason = valid ? null : mapMoveError(ac.message, onSea);
    const destProv = hup.gameState.getMapState().getProvinceAt(target);
    const owner = destProv ? ownerOfProvince(destProv) : null;
    const dist = Math.hypot(start.x - target.x, start.y - target.y);
    let speed = null;
    try {
      speed = army.getSpeed ? army.getSpeed() : army.speed || null;
    } catch (e) {}
    const etaSec =
      speed && Number(speed) > 0 ? Math.round((dist / Number(speed)) * 3600) : null;
    let pathPoints = null;
    try {
      const path = ac.getPath ? ac.getPath() : ac.path || null;
      if (path && path.length) pathPoints = path.length;
    } catch (e) {}
    return {
      valid: valid,
      reason: reason,
      mode: mode,
      armyId: Number(args.armyId),
      target: { x: target.x, y: target.y },
      destination: destProv
        ? {
            id: provinceIdOf(destProv),
            name: destProv.getName && destProv.getName(),
            owner: owner,
          }
        : null,
      distance: Math.round(dist),
      pathPoints: pathPoints,
      etaSec: etaSec,
      etaNote: etaSec
        ? "rough ETA from straight-line distance / client speed — not a confirmed route"
        : "client did not expose speed; no ETA",
      diplomatic: owner ? relationNote(owner.playerId) : null,
      costs: null,
      costsNote: "Ultimate client did not expose order costs on this path",
      fogNote: "No combat odds are computed. Foreign detail may be fogged.",
    };
  }

  let lastProbe = {
    resourceCatalog: false,
    resourceGetter: null,
    allocationFound: false,
    allocationGetters: [],
    allocationSetters: [],
    vpFound: false,
    vpGetter: null,
    enabledScopeSeen: null,
  };
  let resourceGetterNames = null;

  function canonicalResourceName(raw) {
    const s = String(raw == null ? "" : raw)
      .trim()
      .toLowerCase();
    if (!s) return null;
    const aliases = {
      grain: "grain",
      wheat: "grain",
      cereal: "grain",
      getreide: "grain",
      fish: "fish",
      fisch: "fish",
      iron: "iron",
      eisen: "iron",
      lumber: "lumber",
      wood: "lumber",
      holz: "lumber",
      timber: "lumber",
      coal: "coal",
      kohle: "coal",
      oil: "oil",
      petroleum: "oil",
      gas: "gas",
      money: "money",
      gold: "money",
      geld: "money",
    };
    if (aliases[s]) return aliases[s];
    const keys = Object.keys(aliases);
    for (let i = 0; i < keys.length; i++) {
      if (s.indexOf(keys[i]) >= 0) return aliases[keys[i]];
    }
    return null;
  }

  function resourceCatalog() {
    const res = hup.gameState.getResourceState();
    const byId = {};
    const byName = {};
    for (let id = 0; id <= 40; id++) {
      let name = null;
      try {
        name = res.getResourceName(id);
      } catch (e) {}
      const canon = canonicalResourceName(name);
      if (!canon || canon === "money") continue;
      byId[id] = canon;
      if (byName[canon] == null) byName[canon] = id;
    }
    lastProbe.resourceCatalog = Object.keys(byId).length > 0;
    return { byId: byId, byName: byName };
  }

  function getterNamesForResource(sample) {
    if (resourceGetterNames) return resourceGetterNames;
    const preferred = [
      "getResourceType",
      "getResourceName",
      "getResourceID",
      "getResourceId",
      "getProductionType",
      "getProducedResource",
      "getNaturalResource",
      "getProvinceResource",
      "getProductionSlots",
    ];
    const discovered = methodNames(sample).filter(function (n) {
      if (!/^get/i.test(n)) return false;
      if (!/resource|production|output/i.test(n)) return false;
      if (/slotcount|count|size|queue|speed|bonus|factor|cost|price|state|market|order|trade/i.test(n)) {
        return false;
      }
      return true;
    });
    const names = [];
    preferred.concat(discovered).forEach(function (n) {
      if (names.indexOf(n) < 0) names.push(n);
    });
    resourceGetterNames = names;
    return names;
  }

  function callZeroArg(obj, name) {
    try {
      if (typeof obj[name] !== "function") return { missing: true };
      if (obj[name].length > 0) return { skip: true };
      return { value: obj[name]() };
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  }

  function unwrapResourceRaw(v) {
    if (v == null) return null;
    if (typeof v === "number" || typeof v === "string") return v;
    if (typeof v !== "object") return null;
    if (typeof v.getItemID === "function") return v.getItemID();
    if (v.itemID != null) return v.itemID;
    if (typeof v.getResourceID === "function") return v.getResourceID();
    if (v.resourceID != null) return v.resourceID;
    if (typeof v.getName === "function") return v.getName();
    if (v.name != null) return v.name;
    if (v.id != null && (typeof v.id === "number" || typeof v.id === "string")) return v.id;
    return null;
  }

  function resourceIdentity(raw, catalog, depth, allowBareId) {
    if (raw == null || depth > 3) return null;
    if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(String(raw).trim()))) {
      if (!allowBareId) return null;
      const id = Number(raw);
      if (catalog.byId[id]) return { resourceType: catalog.byId[id], resourceId: id };
      return null;
    }
    if (typeof raw === "string") {
      const canon = canonicalResourceName(raw);
      if (canon && canon !== "money" && catalog.byName[canon] != null) {
        return { resourceType: canon, resourceId: catalog.byName[canon] };
      }
      return null;
    }
    if (typeof raw !== "object") return null;
    if (typeof raw.getResourceType === "function") {
      const nested = callZeroArg(raw, "getResourceType");
      const hit = resourceIdentity(nested.value, catalog, depth + 1, true);
      if (hit) return hit;
    }
    if (typeof raw.getResourceName === "function") {
      const nested = callZeroArg(raw, "getResourceName");
      const hit = resourceIdentity(nested.value, catalog, depth + 1, true);
      if (hit) return hit;
    }
    if (typeof raw.getResourceID === "function") {
      const nested = callZeroArg(raw, "getResourceID");
      const hit = resourceIdentity(nested.value, catalog, depth + 1, true);
      if (hit) return hit;
    }
    const list = Array.isArray(raw)
      ? raw
      : typeof raw.length === "number" && raw.length >= 0 && raw.length < 12 && typeof raw !== "function"
        ? Array.prototype.slice.call(raw, 0, raw.length)
        : null;
    if (list) {
      for (let i = 0; i < list.length && i < 6; i++) {
        const hit = resourceIdentity(list[i], catalog, depth + 1, allowBareId);
        if (hit) return hit;
      }
    }
    return null;
  }

  function describeResourceValue(value) {
    if (value == null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    if (Array.isArray(value)) {
      const first = value[0];
      return {
        length: value.length,
        firstType: first == null ? null : typeof first,
        first:
          first && typeof first === "object"
            ? methodNames(first)
                .filter(function (n) {
                  return /resource|name|type|production/i.test(n);
                })
                .slice(0, 8)
            : first,
      };
    }
    return typeof value;
  }

  function resolveProvinceResource(p, catalog) {
    const rejected = [];
    let idHit = null;
    let nameHit = null;
    const names = getterNamesForResource(p);
    const fields = ["resourceID", "resourceId", "resourceType", "resource"];
    function consider(getter, value) {
      const allowBareId = /resource|productiontype/i.test(getter);
      const hit = resourceIdentity(value, catalog, 0, allowBareId);
      if (!hit) {
        const kind = value == null ? "empty" : Array.isArray(value) ? "array" : typeof value;
        rejected.push({
          getter: getter,
          reason: "not a catalog resource",
          kind: kind,
          preview: describeResourceValue(value),
        });
        return;
      }
      const record = {
        resourceType: hit.resourceType,
        resourceId: hit.resourceId,
        resourceGetter: getter,
      };
      if (allowBareId && (typeof value !== "object" || value == null)) {
        if (!idHit) idHit = record;
      } else if (!nameHit && !idHit) {
        nameHit = record;
      } else if (!idHit && allowBareId) {
        idHit = record;
      }
    }
    for (let i = 0; i < names.length; i++) {
      const got = callZeroArg(p, names[i]);
      if (got.missing || got.skip) continue;
      if (got.error) {
        rejected.push({ getter: names[i], reason: got.error });
        continue;
      }
      consider(names[i], got.value);
      if (idHit) break;
    }
    if (!idHit) {
      for (let f = 0; f < fields.length; f++) {
        if (p[fields[f]] == null) continue;
        consider("field:" + fields[f], p[fields[f]]);
        if (idHit) break;
      }
    }
    const hit = idHit || nameHit;
    if (hit && !lastProbe.resourceGetter) lastProbe.resourceGetter = hit.resourceGetter;
    if (!hit) {
      return {
        resourceType: null,
        resourceId: null,
        resourceGetter: null,
        resourceConfidence: "unknown",
        resourceRejected: rejected.slice(0, 8),
      };
    }
    return {
      resourceType: hit.resourceType,
      resourceId: hit.resourceId,
      resourceGetter: hit.resourceGetter,
      resourceConfidence: "confirmed",
      resourceRejected: rejected.slice(0, 4),
    };
  }

  function baseBuildingName(name) {
    let s = String(name || "").trim();
    s = s.replace(/\s+(level|lvl|stufe|tier)\s*\d+$/i, "");
    s = s.replace(/\s+[IVX]+$/i, "");
    s = s.replace(/\s+\d+$/i, "");
    return s || String(name || "");
  }

  function buildingLevelFromName(name) {
    const text = String(name || "");
    const m = text.match(/(?:level|lvl|stufe|tier)\s*(\d+)/i) || text.match(/\s(\d+)$/);
    if (m) return Number(m[1]);
    const rom = text.match(/\s(I|II|III|IV|V)$/);
    if (!rom) return null;
    return { I: 1, II: 2, III: 3, IV: 4, V: 5 }[rom[1]] || null;
  }

  function readUpkeep(u) {
    const names = ["getDailyUpkeep", "getUpkeep", "getMaintenance", "getDailyCosts"];
    for (let i = 0; i < names.length; i++) {
      const got = callZeroArg(u, names[i]);
      if (got.value == null || got.error || got.missing || got.skip) continue;
      return { grain: null, money: null, raw: got.value, source: names[i] };
    }
    return { grain: null, money: null };
  }

  function groupBuildings(p) {
    const list = p.getImprovementsBuilt ? p.getImprovementsBuilt() : p.improvements || [];
    const groups = {};
    const order = [];
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      const id = u.getItemID ? u.getItemID() : u.itemID;
      const rawName = u.getNameWithLevel
        ? u.getNameWithLevel()
        : u.getNameWithTier
          ? u.getNameWithTier()
          : u.getName
            ? u.getName()
            : "";
      const base = baseBuildingName(rawName);
      const key = String(base).toLowerCase();
      const flag = upgradeEnabledFlag(u);
      if (!groups[key]) {
        groups[key] = { name: base || rawName, members: [] };
        order.push(key);
      }
      groups[key].members.push({
        id: id != null ? Number(id) : null,
        name: rawName,
        level: buildingLevelFromName(rawName) || upgradePremiumLevel(u) || null,
        flag: flag,
        condition: upgradeCondition(u),
        upkeep: readUpkeep(u),
      });
    }
    return order.map(function (key) {
      const g = groups[key];
      const flags = g.members.map(function (m) {
        return m.flag;
      });
      const verifiedCount = flags.filter(function (f) {
        return f !== null && f !== undefined;
      }).length;
      let enabledScope = null;
      let enabled = null;
      let enabledVerified = false;
      if (verifiedCount === g.members.length && verifiedCount > 0) {
        enabledScope = "upgrade";
        enabled = flags.every(function (f) {
          return f === true;
        });
        enabledVerified = true;
      } else if (verifiedCount === 1 && g.members.length > 1) {
        enabledScope = "building";
        enabled = flags.filter(function (f) {
          return f !== null && f !== undefined;
        })[0];
        enabledVerified = true;
      } else if (verifiedCount > 0) {
        enabledScope = null;
        enabledVerified = false;
        enabled = null;
      }
      if (enabledScope && !lastProbe.enabledScopeSeen) lastProbe.enabledScopeSeen = enabledScope;
      const levels = g.members.map(function (m) {
        return {
          upgradeId: m.id,
          name: m.name,
          level: m.level,
          enabled: m.flag,
          enabledVerified: m.flag !== null && m.flag !== undefined,
          condition: m.condition,
        };
      });
      const levelNums = levels
        .map(function (m) {
          return m.level;
        })
        .filter(function (n) {
          return typeof n === "number" && n > 0;
        });
      const upkeep = g.members[0] ? g.members[0].upkeep : { grain: null, money: null };
      return {
        name: g.name,
        level: levelNums.length ? Math.max.apply(null, levelNums) : g.members.length,
        upgradeIds: levels
          .map(function (m) {
            return m.upgradeId;
          })
          .filter(function (id) {
            return id != null;
          }),
        enabled: enabled,
        enabledVerified: enabledVerified,
        enabledScope: enabledScope,
        levels: levels,
        upkeep: { grain: upkeep.grain != null ? upkeep.grain : null, money: upkeep.money != null ? upkeep.money : null },
      };
    });
  }

  function wants(include, key) {
    return include.indexOf(key) >= 0;
  }

  function armyOnProvince(map, pid) {
    const rows = [];
    const armies = hup.gameState.getArmyState().getArmiesArray() || [];
    for (let i = 0; i < armies.length; i++) {
      const a = armies[i];
      let pos = null;
      try {
        pos = a.getPosition();
      } catch (e) {}
      if (!pos) continue;
      const prov = map.getProvinceAt(pos);
      if (!prov || provinceIdOf(prov) !== pid) continue;
      const ownerId = a.getOwnerID();
      const self = hup.config.userData.playerID;
      rows.push({
        id: a.getArmyID(),
        ownerId: ownerId,
        friendly: ownerId === self,
        confidence: ownerId === self ? "confirmed" : "fog",
        destination: (function () {
          const cmds = a.getCommands ? a.getCommands() || [] : [];
          for (let c = cmds.length - 1; c >= 0; c--) {
            const tp = readCommandTarget(cmds[c]);
            if (tp) return tp;
          }
          return null;
        })(),
      });
    }
    return rows;
  }

  function getProvinces(args) {
    rebind();
    args = args || {};
    const map = hup.gameState.getMapState();
    if (!map || typeof map.getPlayerProvinces !== "function") {
      throw new Error("mapState not ready — retry ensure_ready");
    }
    const self = hup.config.userData.playerID;
    const catalog = resourceCatalog();
    const include = Array.isArray(args.include) && args.include.length
      ? args.include.map(String)
      : ["resource", "morale"];
    const summaryOnly = !!args.summaryOnly;
    const limit = Math.max(1, Math.min(200, args.limit != null ? Number(args.limit) : 100));
    const offset = Math.max(0, args.cursor != null ? Number(args.cursor) || 0 : 0);
    let pool = [];
    if (args.x != null && args.y != null) {
      const one = map.getProvinceAt(resolvePoint(args.x, args.y));
      pool = one ? [one] : [];
    } else if (args.provinceIdOrName != null) {
      const one = findProvince(args.provinceIdOrName);
      pool = one ? [one] : [];
    } else if (Array.isArray(args.provinceIds) && args.provinceIds.length) {
      pool = args.provinceIds
        .map(function (id) {
          return findProvince(id);
        })
        .filter(Boolean);
    } else if (args.owner === "visible") {
      pool = map.getProvinceArray ? map.getProvinceArray() : [];
    } else if (args.owner != null && args.owner !== "self" && Number(args.owner) > 0) {
      pool = map.getPlayerProvinces(Number(args.owner)) || [];
    } else {
      pool = map.getPlayerProvinces(self) || [];
    }
    const resourceFilter = args.resource != null ? canonicalResourceName(args.resource) : null;
    const buildingNeedle = args.building != null ? String(args.building).trim().toLowerCase() : "";
    const moraleBelow = args.moraleBelow != null ? Number(args.moraleBelow) : null;
    const rows = [];
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      const owner = ownerOfProvince(p);
      const confidence = owner.playerId === self ? "confirmed" : "fog";
      if (args.owner === "visible" && owner.playerId === self) continue;
      const res = resolveProvinceResource(p, catalog);
      if (resourceFilter && res.resourceType !== resourceFilter) continue;
      const morale = p.getMorale ? p.getMorale() : null;
      if (moraleBelow != null && !(typeof morale === "number" && morale < moraleBelow)) continue;
      const coastal = p.isCoastal ? !!p.isCoastal() : !!p.coastal;
      if (args.coastal != null && coastal !== !!args.coastal) continue;
      const needBuildings =
        !summaryOnly &&
        (wants(include, "buildings") || buildingNeedle || args.enabled != null);
      const buildings = needBuildings ? groupBuildings(p) : [];
      if (buildingNeedle || args.enabled != null) {
        const hit = buildings.filter(function (b) {
          const nameOk =
            !buildingNeedle ||
            String(b.name).toLowerCase() === buildingNeedle ||
            String(b.name).toLowerCase().indexOf(buildingNeedle) >= 0 ||
            (b.upgradeIds || []).some(function (id) {
              return String(id) === buildingNeedle;
            });
          if (!nameOk) return false;
          if (args.enabled == null) return true;
          return b.enabled === !!args.enabled && b.enabledVerified === true;
        });
        if (!hit.length) continue;
      }
      const row = {
        id: provinceIdOf(p),
        name: p.getName && p.getName(),
        capital: capitalXY(p),
        owner: owner,
        observedAt: new Date().toISOString(),
        confidence: confidence,
      };
      if (!summaryOnly && wants(include, "resource")) {
        row.resourceType = res.resourceType;
        row.resourceId = res.resourceId;
        row.resourceGetter = res.resourceGetter;
        row.resourceConfidence = res.resourceConfidence;
        if (res.resourceConfidence === "unknown") row.resourceRejected = res.resourceRejected;
      }
      if (!summaryOnly && wants(include, "morale")) row.morale = morale;
      if (summaryOnly) {
        row.resourceType = res.resourceType;
        row.resourceConfidence = res.resourceConfidence;
        row.morale = morale;
      }
      if (!summaryOnly && wants(include, "production")) {
        try {
          row.mainProduction = p.getMainProduction ? p.getMainProduction() : null;
        } catch (e) {
          row.mainProduction = null;
        }
        try {
          row.taxProduction = p.getTaxProduction ? p.getTaxProduction() : null;
        } catch (e2) {
          row.taxProduction = null;
        }
      }
      if (!summaryOnly && wants(include, "buildings")) row.buildings = buildings;
      if (!summaryOnly && wants(include, "terrain")) {
        row.coastal = coastal;
        row.terrainType = p.terrainType != null ? p.terrainType : p.visualTerrainType != null ? p.visualTerrainType : null;
      }
      if (!summaryOnly && wants(include, "neighbors")) {
        const near = neighborCards(p);
        row.neighbors = near.neighbors;
        row.neighborsApproximate = near.approximate;
      }
      if (!summaryOnly && wants(include, "military")) {
        row.military = armyOnProvince(map, provinceIdOf(p));
      }
      rows.push(row);
    }
    rows.sort(function (a, b) {
      return Number(a.id) - Number(b.id);
    });
    const page = rows.slice(offset, offset + limit);
    const next = offset + limit < rows.length ? String(offset + limit) : null;
    return {
      observedAt: new Date().toISOString(),
      gameId: hup.config.userData.gameID,
      selfPlayerId: self,
      count: rows.length,
      limit: limit,
      cursor: String(offset),
      nextCursor: next,
      include: include,
      summaryOnly: summaryOnly,
      provinces: page,
      probe: {
        resourceCatalog: lastProbe.resourceCatalog,
        resourceGetter: lastProbe.resourceGetter,
        enabledScopeSeen: lastProbe.enabledScopeSeen,
      },
    };
  }

  function allocationProbe() {
    const res = hup.gameState.getResourceState();
    let player = null;
    try {
      player = hup.gameState.getPlayerState().getPlayer(hup.config.userData.playerID);
    } catch (e) {}
    const sources = [
      ["resourceState", res],
      ["player", player],
    ];
    const readings = [];
    const setters = [];
    for (let s = 0; s < sources.length; s++) {
      const src = sources[s][0];
      const obj = sources[s][1];
      if (!obj) continue;
      const names = methodNames(obj);
      for (let i = 0; i < names.length; i++) {
        const n = names[i];
        if (!/alloc|slider|ratio|distribution/i.test(n)) continue;
        if (/^get/i.test(n)) {
          const got = callZeroArg(obj, n);
          if (got.value == null || got.error || got.missing || got.skip) continue;
          const t = typeof got.value;
          if (t === "number" || t === "string" || t === "boolean") {
            readings.push({ source: src, getter: n, value: got.value });
          }
        } else if (/^set/i.test(n) && typeof obj[n] === "function") {
          setters.push({ source: src, setter: n, arity: obj[n].length });
        }
      }
    }
    lastProbe.allocationFound = readings.length > 0;
    lastProbe.allocationGetters = readings.map(function (r) {
      return r.source + "." + r.getter;
    });
    lastProbe.allocationSetters = setters;
    return { allocation: readings.length ? readings : null, setters: setters };
  }

  function getEconomy(args) {
    rebind();
    args = args || {};
    const include = Array.isArray(args.include) && args.include.length
      ? args.include.map(String)
      : ["stocks"];
    const out = {
      observedAt: new Date().toISOString(),
      gameId: hup.config.userData.gameID,
      include: include,
    };
    if (wants(include, "stocks")) out.stocks = dumpResources();
    if (wants(include, "allocation")) {
      const alloc = allocationProbe();
      out.allocation = alloc.allocation;
      out.allocationSetters = alloc.setters;
      out.allocationNote = alloc.allocation
        ? "Read from a zero-arg getter. set_resource_allocation is allowed only through preview_actions when a discovered setter arity matches."
        : "No allocation slider API on the client. HAR of moving one slider is required.";
    }
    if (wants(include, "producers")) {
      const cards = [];
      let cursor = null;
      let truncated = false;
      for (let pageNo = 0; pageNo < 20; pageNo++) {
        const page = getProvinces({
          owner: "self",
          include: ["resource", "production"],
          limit: 200,
          cursor: cursor,
          summaryOnly: false,
        });
        cards.push.apply(cards, page.provinces || []);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        if (pageNo === 19) truncated = true;
      }
      const groups = {};
      cards.forEach(function (p) {
        const key = p.resourceType || "unknown";
        if (!groups[key]) groups[key] = [];
        groups[key].push({
          id: p.id,
          name: p.name,
          resourceConfidence: p.resourceConfidence,
          mainProduction: p.mainProduction != null ? p.mainProduction : null,
        });
      });
      out.producers = groups;
      out.producersTruncated = truncated;
    }
    if (wants(include, "forecast")) {
      const stocks = out.stocks || dumpResources();
      const days = Math.max(1, Math.min(10, args.days != null ? Number(args.days) : 5));
      out.forecast = {
        straightLine: true,
        days: days,
        note: "amount + rate * days. Queues are not included.",
        resources: (stocks.resources || []).map(function (r) {
          const rate = Number(r.rate);
          const amount = Number(r.amount);
          return {
            id: r.id,
            name: r.name,
            amount: r.amount,
            rate: r.rate,
            projected: Number.isFinite(amount) && Number.isFinite(rate) ? amount + rate * days : null,
          };
        }),
      };
    }
    out.probe = {
      allocationFound: lastProbe.allocationFound,
      allocationGetters: lastProbe.allocationGetters,
      allocationSetters: lastProbe.allocationSetters,
    };
    return out;
  }

  function readVictoryPoints(player) {
    const names = ["getVictoryPoints", "getScore", "getPoints", "getVictoryPointScore", "getRankingScore"];
    for (let i = 0; i < names.length; i++) {
      const got = callZeroArg(player, names[i]);
      if (got.missing || got.skip || got.error) continue;
      if (typeof got.value === "number" && Number.isFinite(got.value)) {
        return { victoryPoints: got.value, vpGetter: names[i], confidence: "confirmed" };
      }
    }
    const discovered = methodNames(player).filter(function (n) {
      return /victory|score|points/i.test(n) && /^get/i.test(n);
    });
    for (let j = 0; j < discovered.length; j++) {
      const got = callZeroArg(player, discovered[j]);
      if (typeof got.value === "number" && Number.isFinite(got.value)) {
        return { victoryPoints: got.value, vpGetter: discovered[j], confidence: "confirmed" };
      }
    }
    return { victoryPoints: null, vpGetter: null, confidence: "unknown" };
  }

  function getPlayers(args) {
    rebind();
    args = args || {};
    const players = hup.gameState.getPlayerState().getPlayersArray() || [];
    const self = hup.config.userData.playerID;
    const armyCountByOwner = {};
    const armies = hup.gameState.getArmyState().getArmiesArray() || [];
    for (let a = 0; a < armies.length; a++) {
      const ownerId = armies[a].getOwnerID();
      armyCountByOwner[ownerId] = (armyCountByOwner[ownerId] || 0) + 1;
    }
    const want = args.playerIds || args.names || null;
    const rows = [];
    let vpFound = false;
    let vpGetter = null;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const name = p.getName && p.getName();
      const nation = p.getNationName && p.getNationName();
      if (Array.isArray(want) && want.length) {
        const id = p.getPlayerID();
        const ok = want.some(function (w) {
          return String(w) === String(id) || (name && String(name).toLowerCase() === String(w).toLowerCase()) || (nation && String(nation).toLowerCase() === String(w).toLowerCase());
        });
        if (!ok) continue;
      }
      const vp = readVictoryPoints(p);
      if (vp.victoryPoints != null) {
        vpFound = true;
        vpGetter = vp.vpGetter;
      }
      const isSelf = p.getPlayerID() === self;
      let provinceCount = null;
      try {
        const list = hup.gameState.getMapState().getPlayerProvinces(p.getPlayerID());
        provinceCount = list ? list.length : null;
      } catch (e) {
        provinceCount = null;
      }
      rows.push({
        playerId: p.getPlayerID(),
        name: name,
        nationName: nation,
        rankingOrder: p.getRankingOrder && p.getRankingOrder(),
        defeated: !!(p.isDefeated && p.isDefeated()),
        coalition:
          p.getCoalition && p.getCoalition() && p.getCoalition().getName
            ? p.getCoalition().getName()
            : null,
        victoryPoints: vp.victoryPoints,
        vpGetter: vp.vpGetter,
        confidence: vp.confidence,
        provinceCount: provinceCount,
        provinceCountConfidence:
          provinceCount == null ? "unknown" : isSelf ? "confirmed" : "fog",
        visibleArmyCount: armyCountByOwner[p.getPlayerID()] || 0,
        armyCountConfidence: isSelf ? "confirmed" : "fog",
        observedAt: new Date().toISOString(),
      });
    }
    lastProbe.vpFound = vpFound;
    lastProbe.vpGetter = vpGetter;
    rows.sort(function (a, b) {
      return (a.rankingOrder || 999) - (b.rankingOrder || 999);
    });
    return {
      observedAt: new Date().toISOString(),
      gameId: hup.config.userData.gameID,
      players: rows,
      probe: { vpFound: vpFound, vpGetter: vpGetter },
    };
  }

  function armyCard(a, map) {
    const self = hup.config.userData.playerID;
    const pos = a.getPosition();
    const prov = map.getProvinceAt(pos);
    const cmds = a.getCommands ? a.getCommands() || [] : [];
    let destination = null;
    for (let c = cmds.length - 1; c >= 0; c--) {
      const tp = readCommandTarget(cmds[c]);
      if (tp) {
        destination = tp;
        break;
      }
    }
    const ownerId = a.getOwnerID();
    return {
      id: a.getArmyID(),
      ownerId: ownerId,
      friendly: ownerId === self,
      confidence: ownerId === self ? "confirmed" : "fog",
      province: prov && prov.getName ? prov.getName() : null,
      provinceId: prov ? provinceIdOf(prov) : null,
      provinceOwnerId: prov ? ownerOfProvince(prov).playerId : null,
      pos: pos ? { x: pos.x, y: pos.y } : null,
      destination: destination,
      units: (a.getUnits ? a.getUnits() || [] : []).map(function (u) {
        const t = u.getEffectiveUnitType && u.getEffectiveUnitType();
        return {
          name: t && t.getName ? t.getName() : null,
          size: u.getSize ? u.getSize() : null,
        };
      }),
    };
  }

  function getMilitary(args) {
    rebind();
    args = args || {};
    const include = Array.isArray(args.include) ? args.include.map(String) : ["orders"];
    const map = hup.gameState.getMapState();
    const self = hup.config.userData.playerID;
    const armies = (hup.gameState.getArmyState().getArmiesArray() || []).map(function (a) {
      return armyCard(a, map);
    });
    const own = armies.filter(function (a) {
      return a.ownerId === self;
    });
    const visibleForeign = armies.filter(function (a) {
      return a.ownerId !== self;
    });
    let borderThreats = null;
    if (wants(include, "borderThreats")) {
      const ownIds = {};
      (map.getPlayerProvinces(self) || []).forEach(function (p) {
        ownIds[provinceIdOf(p)] = true;
      });
      borderThreats = visibleForeign
        .filter(function (a) {
          return a.provinceOwnerId === self || (a.provinceId != null && ownIds[a.provinceId]);
        })
        .map(function (a) {
          return {
            armyId: a.id,
            province: a.province,
            provinceId: a.provinceId,
            insideOwnProvince: a.provinceOwnerId === self,
            confidence: "fog",
          };
        });
    }
    return {
      observedAt: new Date().toISOString(),
      gameId: hup.config.userData.gameID,
      own: own,
      visibleForeign: visibleForeign,
      borderThreats: borderThreats,
      note: "Foreign armies are only those the client currently exposes. Hidden stacks are omitted, not estimated.",
    };
  }

  function setAllocation(args) {
    args = args || {};
    const probe = allocationProbe();
    const setter = String(args.setter || "");
    const values = Array.isArray(args.values) ? args.values.map(Number) : [];
    if (values.some(function (n) { return !Number.isFinite(n); })) {
      throw new Error("allocation values must be finite numbers");
    }
    const hit = (probe.setters || []).find(function (s) {
      return s.setter === setter && (!args.source || s.source === args.source);
    });
    if (!hit) throw new Error("allocation setter is not on the discovered client API");
    if (hit.arity !== values.length) {
      throw new Error("allocation setter arity " + hit.arity + " != values " + values.length);
    }
    const res = hup.gameState.getResourceState();
    const player = hup.gameState.getPlayerState().getPlayer(hup.config.userData.playerID);
    const obj = hit.source === "player" ? player : res;
    const result = obj[hit.setter].apply(obj, values);
    return { ok: true, setter: setter, result: result == null ? null : String(result) };
  }

  function connectorProbe() {
    return {
      observedAt: new Date().toISOString(),
      gameId: hup.config && hup.config.userData ? hup.config.userData.gameID : null,
      probe: lastProbe,
    };
  }

  function interestingNames(obj) {
    const out = [];
    let o = obj;
    let depth = 0;
    while (o && depth < 5) {
      try {
        out.push.apply(out, Object.getOwnPropertyNames(o));
      } catch (e) {}
      try {
        o = Object.getPrototypeOf(o);
      } catch (e2) {
        break;
      }
      depth++;
    }
    const uniq = [];
    const seen = {};
    for (let i = 0; i < out.length; i++) {
      const n = out[i];
      if (seen[n]) continue;
      seen[n] = true;
      if (/operat|battle|pass|hero|reward|mission|challenge|quest|event|season|point|tier|track/i.test(n)) {
        uniq.push(n);
      }
    }
    return uniq.sort();
  }

  function jsonish(v, depth) {
    if (depth == null) depth = 0;
    if (v == null) return null;
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "string") return v.length > 240 ? v.slice(0, 240) + "…" : v;
    if (depth > 3) return "[depth]";
    if (typeof v === "function") return "[fn:" + (v.length || 0) + "]";
    if (Array.isArray(v)) {
      return v.slice(0, 20).map(function (x) {
        return jsonish(x, depth + 1);
      });
    }
    if (typeof v === "object") {
      const out = {};
      const keys = Object.keys(v).slice(0, 40);
      for (let i = 0; i < keys.length; i++) {
        try {
          out[keys[i]] = jsonish(v[keys[i]], depth + 1);
        } catch (e) {
          out[keys[i]] = "ERR";
        }
      }
      return out;
    }
    return String(v);
  }

  function callMaybe(obj, name, args) {
    try {
      if (!obj || typeof obj[name] !== "function") return { missing: true };
      const fn = obj[name];
      const a = args || [];
      if (fn.length > a.length && a.length === 0) return { skipArity: fn.length };
      return { value: jsonish(fn.apply(obj, a)) };
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  }

  /**
   * Operations / Hero Pass (account battle-pass). Read-only.
   * Point rules come from the Operations UI. Live progress is on the lobby
   * shell (parent page), not Ultimate hup — probe parent + known controllers.
   */
  function dumpOperations(args) {
    rebind();
    args = args || {};
    const probeOnly = !!args.probeOnly;
    const ui = hup.ui || {};
    const parentWin = (function () {
      try {
        return window.parent && window.parent !== window ? window.parent : window.top || null;
      } catch (e) {
        return null;
      }
    })();

    const staticRules = {
      trackName: "The Hero Pass",
      note: "From the Operations / Hero Pass UI. Prefer live progress when present.",
      objectives: [
        {
          id: "kill_produced_unit",
          description: "Kill any produced unit",
          points: 20,
          priority: "volume",
          strategy: "Background points during normal combat. Do not start wars only for this.",
        },
        {
          id: "conquer_enemy_capital",
          description: "Conquer an enemy capital",
          points: 300,
          priority: "high",
          strategy: "Capital pushes are high value when already at war and logistics allow.",
        },
        {
          id: "defeat_hero",
          description: "Defeat a hero in battle",
          points: 500,
          priority: "highest",
          strategy: "Best points-per-action when a hostile hero is visible and fightable.",
        },
      ],
      rewardTiers: {
        free: "Claimable without payment when points unlock the slot.",
        pro: "Paid Battle Pass — MCP never purchases or unlocks this.",
      },
      levelingAdvice: [
        "Rank objectives by points: hero defeat 500 > capital 300 > unit kill 20.",
        "Use Operations as a preference signal inside an already-valid war plan — never as a reason to declare war.",
        "Claim free-tier rewards when exposed; never buy Battle Pass / Goldmark packages via MCP.",
        "If progress is maxed (e.g. 10000/10000), focus free claims and ignore Pro locks.",
      ],
    };

    const controllers = {};
    function scanObj(label, obj) {
      if (!obj || typeof obj !== "object") return;
      let keys = [];
      try {
        keys = Object.keys(obj);
      } catch (e) {
        return;
      }
      for (let i = 0; i < keys.length; i++) {
        if (!/operat|battle|pass|heroPass|challenge|quest|season|reward|bp/i.test(keys[i])) continue;
        // Skip generic in-game event feeds — not the Hero Pass.
        if (/^events?$/i.test(keys[i]) || /gameEvent/i.test(keys[i])) continue;
        controllers[label + "." + keys[i]] = interestingNames(obj[keys[i]]);
      }
    }
    scanObj("hup", hup);
    scanObj("ui", ui);
    scanObj("parent", parentWin);
    try {
      scanObj("parent.angular", parentWin && parentWin.angular);
    } catch (e) {}

    const candidates = [];
    function pushCtrl(c) {
      if (c && typeof c === "object") candidates.push(c);
    }
    pushCtrl(ui.operationsController);
    pushCtrl(ui.operationController);
    pushCtrl(ui.battlePassController);
    pushCtrl(ui.heroPassController);
    pushCtrl(ui.seasonController);
    pushCtrl(ui.challengeController);
    pushCtrl(hup.operationsController);
    pushCtrl(hup.battlePassController);
    try {
      if (parentWin) {
        pushCtrl(parentWin.operationsController);
        pushCtrl(parentWin.battlePassController);
        pushCtrl(parentWin.heroPassController);
      }
    } catch (e2) {}

    const getterHints = [
      "getOperations",
      "getOperation",
      "getActiveOperations",
      "getCurrentOperation",
      "getBattlePass",
      "getHeroPass",
      "getProgress",
      "getPoints",
      "getScore",
      "getRewards",
      "getTiers",
      "getChallenges",
      "getObjectives",
      "getMissions",
      "getModel",
      "getState",
      "getData",
      "getTrack",
      "getTracks",
    ];

    let live = null;
    let via = null;
    const readings = [];
    for (let c = 0; c < candidates.length; c++) {
      const ctrl = candidates[c];
      const methods = interestingNames(ctrl);
      const got = {};
      for (let g = 0; g < getterHints.length; g++) {
        if (typeof ctrl[getterHints[g]] !== "function") continue;
        const r = callMaybe(ctrl, getterHints[g], []);
        if (r.value != null) got[getterHints[g]] = r.value;
        else if (r.error) got[getterHints[g]] = { error: r.error };
      }
      readings.push({ methods: methods.slice(0, 50), got: got });
      if (!live && Object.keys(got).length) {
        live = got;
        via = "controller:" + c;
      }
    }

    // Quest state can hold account challenges; include only if non-empty.
    try {
      const qs = hup.gameState.getQuestState && hup.gameState.getQuestState();
      const quests = qs && qs.quests;
      const qKeys = quests && typeof quests === "object" ? Object.keys(quests) : [];
      if (qKeys.length) {
        readings.push({ source: "gameState.getQuestState", value: jsonish(qs) });
        if (!live) {
          live = jsonish(qs);
          via = "gameState.getQuestState";
        }
      }
    } catch (e3) {}

    // DOM scrape of an open Operations overlay (lobby or iframe).
    let dom = null;
    function scrapeOpsDom(doc) {
      if (!doc || !doc.body) return null;
      const text = (doc.body.innerText || "").replace(/\s+/g, " ").trim();
      if (!/Hero Pass|OPERATIONS|Battle Pass|UNLOCK BATTLE PASS/i.test(text)) return null;
      const progress =
        (text.match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/) || []).slice(1, 3) || null;
      const remaining = (text.match(/(\d+\s*d(?:ays?)?\s*\d+\s*h(?:ours?)?|\d+\s*d\s*\d+\s*h)/i) || [])[1] || null;
      return {
        progressText: progress && progress.length === 2 ? progress[0] + "/" + progress[1] : null,
        pointsCurrent: progress && progress[0] ? Number(String(progress[0]).replace(/[.,]/g, "")) : null,
        pointsMax: progress && progress[1] ? Number(String(progress[1]).replace(/[.,]/g, "")) : null,
        timeRemaining: remaining,
        snippet: text.slice(0, 500),
      };
    }
    try {
      dom = scrapeOpsDom(document) || scrapeOpsDom(parentWin && parentWin.document);
    } catch (e4) {
      dom = { error: e4 && e4.message ? e4.message : String(e4) };
    }
    if (dom && dom.pointsCurrent != null && !live) {
      live = dom;
      via = "dom";
    }

    let parentUrl = null;
    try {
      parentUrl = parentWin && parentWin.location && parentWin.location.href;
    } catch (e5) {
      parentUrl = "cross-origin";
    }

    if (probeOnly) {
      return {
        observedAt: new Date().toISOString(),
        gameId: hup.config.userData.gameID,
        parentUrl: parentUrl,
        controllers: controllers,
        readings: readings.slice(0, 20),
        dom: dom,
        staticRules: staticRules,
      };
    }

    const progress =
      (live && (live.progress || live.points || live.getProgress || live.getPoints)) ||
      (dom && dom.pointsCurrent != null
        ? {
            current: dom.pointsCurrent,
            max: dom.pointsMax,
            text: dom.progressText,
            timeRemaining: dom.timeRemaining,
          }
        : null);

    return {
      observedAt: new Date().toISOString(),
      gameId: hup.config.userData.gameID,
      trackName: staticRules.trackName,
      via: via,
      progress: progress,
      objectives: staticRules.objectives,
      rewardTiers: staticRules.rewardTiers,
      levelingAdvice: staticRules.levelingAdvice,
      live: live,
      note: via
        ? "Operations instructions attached. Live progress via " + via + "."
        : "Hero Pass point rules attached (leveling instructions). Live 10000/10000 progress needs the Operations overlay open or an XHR HAR from opening Operations on the lobby (not the window_open.m4a sound).",
    };
  }

  function campaignBundle() {
    rebind();
    const fin = dumpFinanceProvinces();
    const armies = dumpOwnArmies();
    let resources = [];
    try {
      const r = dumpResources();
      resources = r && r.resources ? r.resources : r;
    } catch (e) {}
    let wars = [];
    try {
      const w = dumpWarPicture({});
      wars = (w && (w.wars || w.enemies || w.relations)) || [];
    } catch (e) {}
    return {
      provinces: (fin.provinces || []).map(function (p) {
        return { id: p.id, name: p.name, morale: p.morale };
      }),
      armies: (armies || []).map(function (a) {
        return { id: a.id, pos: a.pos, province: a.province };
      }),
      resources: resources,
      wars: wars,
    };
  }

  window.s1914 = {
    dumpResources,
    dumpFinanceProvinces,
    dumpOwnArmies,
    dumpAllMessages,
    dumpRelatedWith,
    dumpRelatedByName,
    dumpAllStats,
    dumpDiplomacy,
    dumpCountryStats,
    dumpSpies,
    dumpConstructionOptions,
    dumpProvinceSlots,
    dumpProducibleUnits,
    dumpMarketOffers,
    dumpMyOrders,
    dumpOpenTradeOffers,
    dumpHeroes,
    dumpNews,
    dumpWorldView,
    dumpCountryForces,
    dumpWarPicture,
    dumpArmyCombat,
    listGames,
    currentGame,
    useGame,
    rebind,
    constructBuilding,
    listProvinceUpgrades,
    produceUnit,
    enqueueBuild,
    cancelBuilding,
    cancelUnitProduction,
    placeMarketOrder,
    acceptMarketOrder,
    cancelMarketOrder,
    sendDiploMessage,
    setRelation,
    createTradeOffer,
    respondTradeOffer,
    deployHero,
    writeNews,
    moveArmy,
    moveArmies,
    attackArmy,
    delayArmy,
    setForcedMarch,
    setAggression,
    centerMap,
    setBuildingEnabled,
    bulkSetBuildingEnabled,
    inspectProvince,
    getProvinces,
    getEconomy,
    getPlayers,
    getMilitary,
    connectorProbe,
    dumpOperations,
    stopArmy,
    splitArmy,
    previewArmyOrder,
    campaignBundle,
    exportSession,
    connectCabinetBridge,
    rpc,
    hup,
  };

  /**
   * Stable RPC for mcp_supremacy (snake_case methods).
   * @param {string} method
   * @param {Record<string, unknown>} [args]
   */
  async function rpc(method, args) {
    args = args || {};
    switch (method) {
      case "current_game":
        return currentGame();
      case "list_games":
        return listGames();
      case "use_game": {
        const gid =
          args.gameId != null
            ? Number(args.gameId)
            : args.index != null
              ? Number(args.index)
              : null;
        if (gid == null || Number.isNaN(gid)) {
          throw new Error("use_game needs gameId or index");
        }
        if (!window.s1914._gamesIndex || !window.s1914._gamesIndex.length) {
          await listGames();
        }
        return useGame(gid);
      }
      case "get_resources":
        return dumpResources();
      case "get_relations":
      case "get_diplomacy":
        return dumpDiplomacy();
      case "get_own_armies":
        return dumpOwnArmies();
      case "get_world_summary":
        return dumpWorldView({ summaryOnly: true, excludeSelf: false });
      case "get_messages":
        return dumpAllMessages();
      case "get_thread":
        if (args.playerId != null) return dumpRelatedWith(Number(args.playerId));
        if (args.name != null) return dumpRelatedByName(String(args.name));
        if (args.playerIdOrName != null) {
          const v = args.playerIdOrName;
          if (typeof v === "number" || /^\d+$/.test(String(v).trim())) {
            return dumpRelatedWith(Number(v));
          }
          return dumpRelatedByName(String(v));
        }
        throw new Error("get_thread needs playerId, name, or playerIdOrName");
      case "get_market":
        return dumpMarketOffers(
          args.resourceId != null ? Number(args.resourceId) : undefined,
          args.depth != null ? Number(args.depth) : undefined,
        );
      case "get_spies":
        return dumpSpies(!!args.includeAllDays);
      case "get_news":
        return dumpNews(args.day, {
          onlyPlayer: !!args.onlyPlayer,
        });
      case "get_heroes":
        return dumpHeroes();
      case "get_stats":
        return dumpAllStats();
      case "get_war_picture":
        return dumpWarPicture(args || {});
      case "get_finance_picture":
        return dumpFinanceProvinces();
      case "list_province_upgrades":
        return listProvinceUpgrades(args.provinceIdOrName);
      case "dump_province_slots":
        return dumpProvinceSlots(args.provinceIdOrName);
      case "center_map":
        return centerMap(args);
      case "inspect_province": {
        if (args.provinceIdOrName == null && args.x == null && args.y == null) {
          throw new Error("inspect_province needs provinceIdOrName or x,y");
        }
        const page = getProvinces(
          Object.assign({}, args, {
            limit: 1,
            include: ["resource", "production", "morale", "buildings", "neighbors", "military", "terrain"],
          }),
        );
        if (!page.provinces || !page.provinces[0]) throw new Error("province not found");
        return page.provinces[0];
      }
      case "get_provinces":
        return getProvinces(args);
      case "get_economy":
        return getEconomy(args);
      case "get_players":
        return getPlayers(args);
      case "get_military":
        return getMilitary(args);
      case "connector_probe":
        return connectorProbe();
      case "probe_operations":
        return dumpOperations(Object.assign({}, args, { probeOnly: true }));
      case "get_operations":
        return dumpOperations(args);
      case "set_allocation":
        return setAllocation(args);
      case "stop_army":
        return stopArmy(args.armyId);
      case "split_army":
        return splitArmy(args.armyId, args.units);
      case "preview_army_order":
        return previewArmyOrder(args);
      case "campaign_bundle":
        return campaignBundle();
      case "set_building_enabled":
        return setBuildingEnabled(
          args.provinceIdOrName,
          args.upgradeId != null ? args.upgradeId : args.upgradeName,
          !!args.enabled,
        );
      case "bulk_set_building_enabled":
        return bulkSetBuildingEnabled(args);
      case "move_army":
      case "moveArmy":
        return moveArmy(Number(args.armyId), Number(args.x), Number(args.y), {
          append: !!args.append,
        });
      case "move_armies":
      case "moveArmies":
        return moveArmies(args.armyIds || args.armyId, Number(args.x), Number(args.y), {
          append: !!args.append,
        });
      case "attack_army":
      case "attackArmy":
        return attackArmy(Number(args.armyId), Number(args.targetArmyId));
      case "delay_army":
      case "delayArmy":
        return delayArmy(
          Number(args.armyId),
          Number(args.minutes),
          !!args.syncArrival,
        );
      case "set_forced_march":
        return setForcedMarch(Number(args.armyId), !!args.enabled);
      case "set_aggression":
        return setAggression(Number(args.armyId), Number(args.level));
      case "deploy_hero":
        return deployHero(args.heroIdOrName, args.provinceIdOrName);
      case "construct_building":
      case "constructBuilding":
        return constructBuilding(args.provinceIdOrName, Number(args.upgradeId));
      case "produce_unit":
        return produceUnit(args.provinceIdOrName, Number(args.unitTypeId));
      case "enqueue_build":
        return enqueueBuild(args.provinceIdOrName, Number(args.upgradeId));
      case "cancel_building":
        return cancelBuilding(args.provinceIdOrName, Number(args.slot || 0));
      case "cancel_unit_production":
        return cancelUnitProduction(args.provinceIdOrName, Number(args.slot || 0));
      case "place_market_order":
        return placeMarketOrder(
          String(args.side),
          Number(args.resourceId),
          Number(args.amount),
          Number(args.limit),
        );
      case "accept_market_order":
        return acceptMarketOrder(Number(args.orderId), Number(args.amount));
      case "cancel_market_order":
        return cancelMarketOrder(Number(args.orderId));
      case "send_message":
      case "send_diplo":
        {
          const target =
            args.playerIdOrName != null
              ? args.playerIdOrName
              : args.playerId != null
                ? args.playerId
                : args.name;
          if (target == null || args.text == null) {
            throw new Error("send_message needs playerIdOrName|playerId|name and text");
          }
          return sendDiploMessage(target, String(args.text));
        }
      case "set_relation":
        {
          const target =
            args.playerIdOrName != null
              ? args.playerIdOrName
              : args.playerId != null
                ? args.playerId
                : args.name;
          if (target == null || args.relation == null) {
            throw new Error("set_relation needs player + relation");
          }
          return setRelation(target, Number(args.relation));
        }
      case "create_trade_offer":
        {
          const target =
            args.playerIdOrName != null
              ? args.playerIdOrName
              : args.playerId != null
                ? args.playerId
                : args.name;
          if (target == null) throw new Error("create_trade_offer needs player");
          return createTradeOffer(
            target,
            args.offer || args.offerA || {},
            args.ask || args.offerB || {},
            args.message != null ? String(args.message) : "",
          );
        }
      case "respond_trade_offer":
        return respondTradeOffer(
          Number(args.tradeId != null ? args.tradeId : args.tradeOfferId),
          String(args.action || args.actionName || "accept"),
        );
      case "write_news":
      case "writeNews":
        return writeNews(String(args.title || ""), String(args.body || ""), {
          anonymous: !!args.anonymous,
          imageData: args.imageData || null,
          imageName: args.imageName || null,
        });
      case "export_session":
        return exportSession({ secrets: !!args.secrets });
      default:
        throw new Error("unknown rpc method: " + method);
    }
  }

  console.log(
    "s1914 ready (mcp_supremacy): listGames(), rpc(method, args), exportSession({secrets:true})",
  );
})();
