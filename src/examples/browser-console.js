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
      note: "Wait for map load, then run s1914.rebind() (or re-paste browser-console.js). Then exportSession() for new keys.",
    };
  }

  function dumpResources() {
    const res = hup.gameState.getResourceState();
    const ids = [0, 1, 2, 3, 4, 5, 6, 20];
    return ids.map((id) => {
      const name = res.getResourceName(id);
      const e = res.getPlayerResourceEntry(id);
      if (!name || !e) return null;
      return {
        id,
        name,
        amount: e.getAmount(),
        production: e.getProduction(),
        consumption: e.getConsumption(),
        rate: e.getRate(),
      };
    }).filter(Boolean);
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
            };
          }),
          commands: (a.getCommands() || []).length,
        };
      });
  }

  function moveArmy(armyId, targetX, targetY) {
    const army = hup.gameState.getArmyState().getArmy(armyId);
    if (!army) throw new Error("army not found");
    const Point = army.getPosition().constructor;
    const target = hup.gameState
      .getMapState()
      .closestMapPoint(new Point(targetX, targetY), false);
    hup.armySelection.setSelected([army]);
    const ac = hup.mapMouseController.armyController;
    ac.updateMoveSelection();
    ac.setCommandMode(0);
    ac.setDragTarget(target, null);
    if (!ac.isValidCommand) {
      throw new Error(ac.message || "invalid command");
    }
    ac.sendAction();
    return { ok: true, armyId, target };
  }

  /** Attack / bombard enemy army. Same wire `@c:"ac"`; bombard = ranged fight status. */
  function attackArmy(armyId, targetArmyId) {
    const army = hup.gameState.getArmyState().getArmy(armyId);
    if (!army) throw new Error("army not found");
    const targetArmy = hup.gameState.getArmyState().getArmy(targetArmyId);
    if (!targetArmy) throw new Error("target army not found");
    const pos = targetArmy.getPosition();
    const Point = army.getPosition().constructor;
    const target = hup.gameState
      .getMapState()
      .closestMapPoint(new Point(pos.x, pos.y), false);
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
      willBombard:
        (army.getRange && army.getRange()) >
        5 /* CLOSE_COMBAT-ish; client uses unit range */,
      target,
    };
  }

  /** UI Delay in minutes (uses game timeScale). */
  function delayArmy(armyId, minutes, syncArrival) {
    if (!(minutes > 0)) throw new Error("minutes must be > 0");
    const army = hup.gameState.getArmyState().getArmy(armyId);
    if (!army) throw new Error("army not found");
    hup.armySelection.setSelected([army]);
    const ac = hup.mapMouseController.armyController;
    ac.updateMoveSelection();
    ac.setSelectedWaitTime(!!syncArrival, Number(minutes));
    ac.sendDelayAction();
    const scale = hup.gameState.getGameInfoState().getTimeScale();
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
      threads: threads.map((t) => ({
        otherPlayerId: t.otherPlayerId,
        other: t.other,
        count: t.count,
        last: t.messages[t.messages.length - 1] && {
          bodyText: t.messages[t.messages.length - 1].bodyText.slice(0, 160),
          timestamp: t.messages[t.messages.length - 1].timestamp,
        },
      })),
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
        provincesCaptured: pss.getNumProvincesCaptured(pid),
        provincesLost: pss.getNumProvincesLost(pid),
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

    return {
      total: rows.length,
      histogram: hist,
      atWar: rows.filter((r) => r.war),
      rightOfWay: rows.filter((r) => r.relation === 3),
      shareMapOrBetter: rows.filter((r) => r.relation >= 4),
      enemies: fa.getEnemies && fa.getEnemies(pid),
      allies: fa.getAllies && fa.getAllies(pid),
      nonPeace: rows.filter((r) => r.relation !== 1),
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

  function exportSession() {
    const ud = hup.config.userData;
    return {
      gameServerUri: hup.userActionController.server.serverUri,
      client: hup.config.client,
      version: String(w.clientVersion || "293"),
      gameID: ud.gameID,
      playerID: ud.playerID,
      siteUserID: ud.siteUserID,
      userAuth: ud.userAuth,
      tstamp: String(ud.tstamp),
      rights: ud.rights,
      adminLevel: ud.adminLevel,
    };
  }

  function findProvince(idOrName) {
    const map = hup.gameState.getMapState();
    if (typeof idOrName === "number") {
      const byId = map.getProvince(idOrName);
      if (byId) return byId;
    }
    const needle = String(idOrName).toLowerCase();
    const all = map.getProvinceArray ? map.getProvinceArray() : [];
    return all.find((p) => {
      const name = p.getName && p.getName();
      const id = p.getLocationID && p.getLocationID();
      return (
        (name && String(name).toLowerCase() === needle) ||
        String(id) === needle
      );
    });
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

  function constructBuilding(provinceIdOrName, upgradeId) {
    const p = findProvince(provinceIdOrName);
    if (!p) throw new Error("province not found");
    const pid = provinceIdOf(p);
    const groups = hup.ProvinceProductionUtils.getConstructionGroups([pid]) || [];
    let item = null;
    let upgrade = null;
    for (const g of groups) {
      for (const it of g.items || []) {
        const up = it.getUpgrade && it.getUpgrade();
        const id = up && (up.getItemID ? up.getItemID() : up.itemID);
        if (id === upgradeId) {
          item = it;
          upgrade = up;
          break;
        }
      }
      if (upgrade) break;
    }
    if (!upgrade) throw new Error("upgrade not found for province: " + upgradeId);
    const costs =
      (item.getRawProducibleCostsForProvinces &&
        item.getRawProducibleCostsForProvinces([pid])) ||
      {};
    hup.provinceController.constructBuilding([pid], upgrade, costs);
    return {
      ok: true,
      provinceId: pid,
      upgradeId,
      name: item.getName && item.getName(),
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
            return {
              unitTypeId: typeId,
              name: cfg && cfg.getName && cfg.getName(),
              shortName: cfg && cfg.getShortName && cfg.getShortName(),
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
              commands: (a.getCommands && a.getCommands() || []).length,
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

  window.s1914 = {
    dumpResources,
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
    dumpArmyCombat,
    listGames,
    currentGame,
    useGame,
    rebind,
    constructBuilding,
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
    attackArmy,
    delayArmy,
    setForcedMarch,
    setAggression,
    exportSession,
    hup,
  };

  console.log(
    "s1914 ready: listGames(), useGame(index|gameId), currentGame(), rebind(), exportSession()",
  );
})();
