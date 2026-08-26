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
    const gs = hup.gameState;
    const map = gs.getMapState();
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
    const all = map.getProvinceArray ? map.getProvinceArray() : [];
    let hit = all.find((p) => {
      const name = p.getName && p.getName();
      const id = p.getLocationID && p.getLocationID();
      return (
        (name && String(name).toLowerCase() === needle) ||
        String(id) === needle
      );
    });
    if (hit) return hit;
    const partial = all.filter((p) => {
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
    return p.getLocationID ? p.getLocationID() : p.locationID;
  }

  function dumpConstructionOptions(provinceIdOrName) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const pid = provinceIdOf(p);
    const groups = hup.ProvinceProductionUtils.getConstructionGroups([pid]) || [];
    return {
      provinceId: pid,
      name: p.getName && p.getName(),
      building: p.isBuilding && p.isBuilding(),
      producing: p.isProducing && p.isProducing(),
      groups: groups.map((g) => ({
        name: g.getName && g.getName(),
        items: (g.items || []).map((it) => {
          const up = it.getUpgrade && it.getUpgrade();
          return {
            name: it.getName && it.getName(),
            available: it.isAvailable && it.isAvailable(),
            upgradeId: up && (up.getItemID ? up.getItemID() : up.itemID),
            condition: up && (up.getCondition ? up.getCondition() : up.condition),
            wire: up
              ? {
                  "@c": "mu",
                  c: up.getCondition ? up.getCondition() : up.condition,
                  e: up.isEnabled ? up.isEnabled() : up.enabled,
                  id: up.getItemID ? up.getItemID() : up.itemID,
                  pl: up.getPremiumLevel ? up.getPremiumLevel() : up.premiumLevel,
                  rp: up.getRelativePosition
                    ? up.getRelativePosition()
                    : up.relativePosition,
                }
              : null,
          };
        }),
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

  function listProvinceUpgrades(provinceIdOrName) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found: " + provinceIdOrName);
    const pid = provinceIdOf(p);
    const groups = hup.ProvinceProductionUtils.getConstructionGroups([pid]) || [];
    const upgrades = [];
    for (const g of groups) {
      for (const it of g.items || []) {
        const up = it.getUpgrade && it.getUpgrade();
        const id = up && (up.getItemID ? up.getItemID() : up.itemID);
        if (id == null) continue;
        const costs = upgradeCostsForItem(it, pid);
        const moneyCost = Number(costs[20] || 0);
        upgrades.push({
          upgradeId: id,
          name: (it.getName && it.getName()) || (up.getName && up.getName()) || String(id),
          group: g.name || g.title || null,
          costs: costs,
          moneyCost: moneyCost,
          affordable: canAffordUpgradeCosts(costs).ok,
        });
      }
    }
    return {
      provinceId: pid,
      provinceName: p.getName ? p.getName() : String(provinceIdOrName),
      upgrades,
    };
  }

  function constructBuilding(provinceIdOrName, upgradeId) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const pid = provinceIdOf(p);
    const groups = hup.ProvinceProductionUtils.getConstructionGroups([pid]) || [];
    let item = null;
    let upgrade = null;
    const available = [];
    for (const g of groups) {
      for (const it of g.items || []) {
        const up = it.getUpgrade && it.getUpgrade();
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
            const up = it.getUpgrade && it.getUpgrade();
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
    const groups = hup.ProvinceProductionUtils.getConstructionGroups([pid]) || [];
    let upgrade = null;
    for (const g of groups) {
      for (const it of g.items || []) {
        const up = it.getUpgrade && it.getUpgrade();
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
    const needle = String(idOrName).toLowerCase();
    return hup.gameState
      .getPlayerState()
      .getPlayersArray()
      .find((p) => {
        const name = (p.getName && p.getName()) || "";
        const nation = (p.getNationName && p.getNationName()) || "";
        return (
          name.toLowerCase() === needle ||
          nation.toLowerCase() === needle ||
          name.toLowerCase().includes(needle)
        );
      });
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
        moraleThreshold: it.deploymentMoraleThreshold,
        canDeploy: obtained && !deployed && !onCooldown && !locked,
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
    const req = webpackRequire();
    const Article = req(28384).S;
    const NewArticleAction = req(10243).I;
    const profile = hup.gameState.getPlayerProfile();
    const art = new Article();
    const anonymous = !!(options && options.anonymous);
    art.updateArticle(profile, String(title), String(body), anonymous);
    const imageData = (options && options.imageData) || null;
    const imageName = (options && options.imageName) || null;
    const action = new NewArticleAction(art, imageData, imageName);
    hup.userActionController.triggerActionWithOptions(action, {
      onSuccess: function () {
        console.log("newspaper article published");
      },
    });
    return {
      ok: true,
      title: String(title),
      bodyPreview: String(body).slice(0, 120),
      anonymous,
    };
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
    exportSession,
    connectCabinetBridge,
    hup,
  };

  console.log(
    "s1914 ready: connectCabinetBridge(url, token), listGames(), exportSession({secrets:true}), @cabinet via npm run cabinet",
  );
})();
