module CallMedia exposing
    ( Layout(..)
    , Local
    , Notice(..)
    , Peer
    , PeerKind(..)
    , Quality
    , ShareState(..)
    , Speaker
    , SpeakerConfig
    , StageSize(..)
    , StageView(..)
    , Tile
    , TileKind(..)
    , advanceQuality
    , advanceSpeaker
    , blankLocal
    , blankQuality
    , blankSpeaker
    , buildTiles
    , cameraOff
    , clampPage
    , consumePrompt
    , decodeLocal
    , decodePeers
    , defaultSpeakerConfig
    , gridColumns
    , layoutToggleLabel
    , nextStageSize
    , noticeCopy
    , pageCount
    , pageSize
    , pageSlice
    , promptCopy
    , qualityBars
    , qualityHoldMs
    , qualityLabel
    , reconcileOrder
    , requestShare
    , resolveView
    , roomStatus
    , shareCaption
    , shareDisabled
    , shareLabel
    , sizeWord
    , speakerSamples
    , spotlightPrimary
    , stageSizeLabel
    , stepSpeaker
    , tileAria
    , tileQualityBars
    , viewWord
    )

{-| v3/calls-c4 — pure call-media logic for calls slices C4 + C5
(`elm/design/calls/CALLS_DESIGN.md` §2.4, §2.6, §2.7, §2.13, §5).

  - C4 local media: camera / screen share / deafen state with the
    oracle `VoiceBar` share labels and live-region copy, the fail-closed
    fold of the engine-confirmed local flags on the `voiceCallHub`
    snapshot, and the connection-quality machinery — a port of
    `connectionQualityAction.ts` (turn-off-camera soft prompt) and
    `bandwidthLadderFeedback.ts` (one-shot ladder toasts) sharing one
    2.5s hysteresis.
  - C5 video: the fail-closed `voicePeerState` decode, the
    dominant-speaker fold (a port of `activeSpeaker.ts`: 400ms hold,
    800ms release), stable tile order with page-boundary promotion,
    grid columns, spotlight / screenshare resolution, paging of 16 and
    the participant-tile aria (`ParticipantTile.tsx` order).

DOM-free; MediaStreams never enter Elm — tiles carry an id that
`ports.js` binds to a `<video>` by `data-voice-tile`.

-}

import CallUi
import Dict exposing (Dict)
import Json.Decode as Decode
import Media exposing (CallLifecycle(..), MediaState)
import Set exposing (Set)



-- C4 · LOCAL MEDIA


type ShareState
    = ShareOff
    | SharePending
    | ShareOn


{-| Local media as the engine confirmed it. `camera` is set
optimistically by the toggle and then overwritten by the engine's
answer; `share` waits in `SharePending` until the engine reports. The
two capability flags default to "unsupported" until the bridge says
otherwise, so nothing is offered that the browser cannot do.
-}
type alias Local =
    { camera : Bool
    , share : ShareState
    , deafened : Bool
    , shareSupported : Bool
    , pipSupported : Bool
    , cameraSupported : Bool
    , shareStatus : String
    , tier : Maybe Int
    }


blankLocal : Local
blankLocal =
    { camera = False
    , share = ShareOff
    , deafened = False
    , shareSupported = False
    , pipSupported = False
    , cameraSupported = False
    , shareStatus = ""
    , tier = Nothing
    }


{-| Share button aria-label / title (oracle `screenshareLabel`). -}
shareLabel : Local -> String
shareLabel local =
    case local.share of
        ShareOn ->
            "Stop sharing screen"

        SharePending ->
            "Starting screen sharing"

        ShareOff ->
            if local.shareSupported then
                "Share screen"

            else
                "Screen sharing unavailable"


shareCaption : Local -> String
shareCaption local =
    if local.share == ShareOn then
        "Sharing"

    else
        "Share"


{-| Disabled while unavailable (unless already sharing, so it can
always be stopped) and while a start is pending.
-}
shareDisabled : Local -> Bool
shareDisabled local =
    case local.share of
        ShareOn ->
            False

        SharePending ->
            True

        ShareOff ->
            not local.shareSupported


{-| One share toggle: `Just (next, on)` when a command should go to
the engine, `Nothing` when the toggle is inert (pending / unavailable).
-}
requestShare : Local -> Maybe ( Local, Bool )
requestShare local =
    case local.share of
        ShareOn ->
            Just ( { local | share = ShareOff, shareStatus = "Screen sharing stopped" }, False )

        SharePending ->
            Nothing

        ShareOff ->
            if local.shareSupported then
                Just ( { local | share = SharePending, shareStatus = "Requesting screen sharing permission" }, True )

            else
                Nothing


shareDidNotStart : String
shareDidNotStart =
    "Screen sharing did not start. Check browser permission and try again"


{-| Fold the local-media fields of one `voiceCallHub` snapshot. An
idle snapshot clears call state (capabilities stay — they belong to
the browser); an absent field keeps the previous value; a present but
invalid one fails closed (flag off, tier unknown).
-}
decodeLocal : CallLifecycle -> Decode.Value -> Local -> Local
decodeLocal lifecycle raw prev =
    let
        field name decoder =
            case Decode.decodeValue (Decode.field name Decode.value) raw of
                Ok value ->
                    Just (Decode.decodeValue decoder value |> Result.toMaybe)

                Err _ ->
                    Nothing

        flag name previous =
            case field name Decode.bool of
                Just (Just b) ->
                    b

                Just Nothing ->
                    False

                Nothing ->
                    previous

        shareSupported =
            flag "shareSupported" prev.shareSupported

        pipSupported =
            flag "pipSupported" prev.pipSupported

        -- Absent keeps the previous value. Fails closed (default False):
        -- the camera is offered only once the engine says video is on
        -- (ports.js `voiceCapabilities`); it reports False while video
        -- is switched off on the live network.
        cameraSupported =
            flag "cameraSupported" prev.cameraSupported
    in
    if lifecycle == Idle then
        { blankLocal | shareSupported = shareSupported, pipSupported = pipSupported, cameraSupported = cameraSupported }

    else
        let
            screenError =
                field "screenError" Decode.bool == Just (Just True)

            screen =
                case field "screen" Decode.bool of
                    Just (Just b) ->
                        Just b

                    Just Nothing ->
                        Just False

                    Nothing ->
                        if screenError then
                            Just False

                        else
                            Nothing

            ( share, status ) =
                case screen of
                    Just True ->
                        ( ShareOn
                        , if prev.share == ShareOn then
                            prev.shareStatus

                          else
                            "Screen sharing started"
                        )

                    Just False ->
                        case prev.share of
                            SharePending ->
                                ( ShareOff, shareDidNotStart )

                            ShareOn ->
                                ( ShareOff, "Screen sharing stopped" )

                            ShareOff ->
                                ( ShareOff
                                , if screenError then
                                    shareDidNotStart

                                  else
                                    prev.shareStatus
                                )

                    Nothing ->
                        ( prev.share, prev.shareStatus )

            tier =
                case field "qualityTier" (Decode.nullable Decode.int) of
                    Just (Just (Just t)) ->
                        if t >= 0 && t <= 3 then
                            Just t

                        else
                            Nothing

                    Just _ ->
                        Nothing

                    Nothing ->
                        prev.tier
        in
        { camera = flag "camera" prev.camera
        , share = share
        , deafened = flag "deafened" prev.deafened
        , shareSupported = shareSupported
        , pipSupported = pipSupported
        , cameraSupported = cameraSupported
        , shareStatus = status
        , tier = tier
        }


{-| Room-header chip status with the full local-health arm of
`buildVoiceRoomStatus` (captions are still left out): up to two visible
labels plus "+N", every part in the aria, only while in this call.
-}
roomStatus :
    { participants : List String
    , speaking : Set String
    , raised : Set String
    , muted : Set String
    , currentCall : Bool
    , localMuted : Bool
    , local : Local
    }
    -> CallUi.RoomStatus
roomStatus input =
    let
        base =
            CallUi.roomStatus
                { participants = input.participants
                , speaking = input.speaking
                , raised = input.raised
                , muted = input.muted
                , currentCall = input.currentCall
                , localMuted = False
                }

        health =
            List.filterMap identity
                [ when input.localMuted ( "muted", "your microphone is muted" )
                , when input.local.deafened ( "deafened", "you are deafened" )
                , when (input.local.share == ShareOn) ( "sharing", "you are sharing your screen" )
                , when input.local.camera ( "video", "your camera is on" )
                ]

        visible =
            List.take 2 health

        hidden =
            List.length health - List.length visible

        healthLabel =
            String.join ", " (List.map Tuple.first visible)
                ++ (if hidden > 0 then
                        " +" ++ String.fromInt hidden

                    else
                        ""
                   )

        join sep a b =
            if String.isEmpty a then
                b

            else
                a ++ sep ++ b
    in
    if input.currentCall && not (List.isEmpty health) then
        { label = join " · " base.label healthLabel
        , aria = join ", " base.aria (String.join ", " (List.map Tuple.second health))
        }

    else
        base


when : Bool -> a -> Maybe a
when on value =
    if on then
        Just value

    else
        Nothing



-- C4 · CONNECTION QUALITY


{-| Hysteresis before a tier counts as stable (`CQ_ACTION_HYSTERESIS_MS`
= `BANDWIDTH_LADDER_HYSTERESIS_MS` = 2500).
-}
qualityHoldMs : Float
qualityHoldMs =
    2500


type Notice
    = NoticeLowering
    | NoticeAudioPriority


{-| The shared hysteresis plus the two consumers' memory: the prompt's
`consumed` flag and the ladder's `announced` floor.
-}
type alias Quality =
    { stable : Maybe Int
    , candidate : Maybe Int
    , since : Float
    , consumed : Bool
    , show : Bool
    , announced : Maybe Int
    }


blankQuality : Quality
blankQuality =
    { stable = Nothing
    , candidate = Nothing
    , since = 0
    , consumed = False
    , show = False
    , announced = Nothing
    }


{-| One quality sample. With no engine tier yet only the prompt
visibility is recomputed (camera may have changed). Returns a ladder
notice exactly once per newly stable degradation into Fair / Poor;
recovery to a better stable tier re-arms it. The prompt shows only
for a stable Poor tier with the camera on, until consumed; any raw
sample above Poor re-arms it.
-}
advanceQuality : { nowMs : Float, tier : Maybe Int, camera : Bool } -> Quality -> ( Quality, Maybe Notice )
advanceQuality input prev =
    case input.tier of
        Nothing ->
            ( { prev | show = prev.stable == Just 3 && input.camera && not prev.consumed }, Nothing )

        Just tier ->
            let
                consumed =
                    prev.consumed && tier >= 3

                ( stable, candidate, since ) =
                    if prev.stable == Just tier then
                        ( prev.stable, Nothing, 0 )

                    else if prev.candidate == Just tier then
                        if input.nowMs - prev.since >= qualityHoldMs then
                            ( Just tier, Nothing, 0 )

                        else
                            ( prev.stable, prev.candidate, prev.since )

                    else
                        ( prev.stable, Just tier, input.nowMs )

                ( announced, notice ) =
                    case ( stable /= prev.stable, stable ) of
                        ( True, Just to ) ->
                            let
                                rearmed =
                                    case prev.announced of
                                        Just floor ->
                                            if to < floor then
                                                Nothing

                                            else
                                                Just floor

                                        Nothing ->
                                            Nothing
                            in
                            case degradation prev.stable to rearmed of
                                Just n ->
                                    ( Just to, Just n )

                                Nothing ->
                                    ( rearmed, Nothing )

                        _ ->
                            ( prev.announced, Nothing )
            in
            ( { stable = stable
              , candidate = candidate
              , since = since
              , consumed = consumed
              , show = stable == Just 3 && input.camera && not consumed
              , announced = announced
              }
            , notice
            )


degradation : Maybe Int -> Int -> Maybe Int -> Maybe Notice
degradation from to announced =
    case from of
        Nothing ->
            Nothing

        Just f ->
            if to <= f then
                Nothing

            else if Maybe.map (\a -> to <= a) announced == Just True then
                Nothing

            else if to >= 3 then
                Just NoticeAudioPriority

            else if to >= 2 then
                Just NoticeLowering

            else
                Nothing


{-| Mark the soft prompt consumed (acted on or dismissed). -}
consumePrompt : Quality -> Quality
consumePrompt q =
    { q | consumed = True, show = False }


noticeCopy : Notice -> { title : String, description : String }
noticeCopy notice =
    case notice of
        NoticeLowering ->
            { title = "Adjusting video quality", description = "Lowering video quality to keep audio clear." }

        NoticeAudioPriority ->
            { title = "Protecting audio", description = "Connection is weak — reducing video to keep audio clear." }


promptCopy : { message : String, actionLabel : String, dismissLabel : String }
promptCopy =
    { message = "Poor connection — turn off camera to keep audio clear."
    , actionLabel = "Turn off camera"
    , dismissLabel = "Dismiss connection tip"
    }


qualityLabel : Int -> String
qualityLabel tier =
    case tier of
        0 ->
            "Excellent"

        1 ->
            "Good"

        2 ->
            "Fair"

        _ ->
            "Poor"


{-| Bar pip: four bars (`VoiceBar` `TIER_META`). -}
qualityBars : Int -> Int
qualityBars tier =
    case tier of
        0 ->
            4

        1 ->
            3

        2 ->
            2

        _ ->
            1


{-| Tile pip: three bars (`ParticipantTile` `QUALITY_META`). -}
tileQualityBars : Int -> Int
tileQualityBars tier =
    case tier of
        0 ->
            3

        1 ->
            3

        2 ->
            2

        _ ->
            1



-- C5 · PEER FEED


type PeerKind
    = KindVoice
    | KindVideo
    | KindScreen


{-| Per-peer media flags from the `voicePeerState` port
(`CadencePeerState` minus the canvas, plus the bandwidth-stop and
optional per-peer quality the engine may report).
-}
type alias Peer =
    { nick : String
    , kind : PeerKind
    , hasVideo : Bool
    , speaking : Bool
    , muted : Bool
    , videoPaused : Bool
    , quality : Maybe Int
    }


{-| Decode one `{ peers: [...] }` payload into a fresh map keyed by
lowercased nick. Invalid entries drop; unknown kinds fail closed to
voice; every flag defaults off; per-peer quality outside 0–3 is
unknown. A payload without a `peers` list is rejected (`Nothing`).
-}
decodePeers : Decode.Value -> Maybe (Dict String Peer)
decodePeers raw =
    let
        boolField name =
            Decode.oneOf [ Decode.field name Decode.bool, Decode.succeed False ]

        kindField =
            Decode.oneOf
                [ Decode.field "kind" Decode.string
                    |> Decode.map
                        (\k ->
                            case k of
                                "video" ->
                                    KindVideo

                                "screen" ->
                                    KindScreen

                                _ ->
                                    KindVoice
                        )
                , Decode.succeed KindVoice
                ]

        qualityField =
            Decode.oneOf
                [ Decode.field "quality" Decode.int
                    |> Decode.map
                        (\t ->
                            if t >= 0 && t <= 3 then
                                Just t

                            else
                                Nothing
                        )
                , Decode.succeed Nothing
                ]

        peerDecoder =
            Decode.map7 Peer
                (Decode.field "nick" Decode.string)
                kindField
                (boolField "hasVideo")
                (boolField "speaking")
                (boolField "muted")
                (boolField "videoPaused")
                qualityField

        entry value =
            case Decode.decodeValue peerDecoder value of
                Ok peer ->
                    if Media.validEngineNick peer.nick then
                        Just ( String.toLower peer.nick, peer )

                    else
                        Nothing

                Err _ ->
                    Nothing
    in
    case Decode.decodeValue (Decode.field "peers" (Decode.list Decode.value)) raw of
        Ok values ->
            values
                |> List.filterMap entry
                |> List.take Media.maxParticipants
                |> Dict.fromList
                |> Just

        Err _ ->
            Nothing



-- C5 · DOMINANT SPEAKER


type alias SpeakerConfig =
    { smoothingMs : Float
    , floor : Float
    , margin : Float
    , holdMs : Float
    , releaseMs : Float
    , maxPeers : Int
    }


{-| `DEFAULT_ACTIVE_SPEAKER_CONFIG`: 400ms challenger hold, 800ms
silence release.
-}
defaultSpeakerConfig : SpeakerConfig
defaultSpeakerConfig =
    { smoothingMs = 200
    , floor = 0.15
    , margin = 0.1
    , holdMs = 400
    , releaseMs = 800
    , maxPeers = 64
    }


type alias Speaker =
    { energies : Dict String Float
    , dominant : Maybe String
    , challenger : Maybe String
    , challengeMs : Float
    , silentMs : Float
    , at : Float
    }


blankSpeaker : Speaker
blankSpeaker =
    { energies = Dict.empty
    , dominant = Nothing
    , challenger = Nothing
    , challengeMs = 0
    , silentMs = 0
    , at = 0
    }


clampUnit : Float -> Float
clampUnit v =
    if isNaN v || v < 0 then
        0

    else if v > 1 then
        1

    else
        v


{-| Loudest peer at/above the floor, ties to the smaller nick (`Dict`
iterates ascending, so a strict `>` keeps the first).
-}
topPeer : Dict String Float -> Float -> Maybe String -> Maybe ( String, Float )
topPeer energies floor exclude =
    Dict.foldl
        (\nick energy best ->
            if Just nick == exclude || energy < floor then
                best

            else
                case best of
                    Just ( _, e ) ->
                        if energy > e then
                            Just ( nick, energy )

                        else
                            best

                    Nothing ->
                        Just ( nick, energy )
        )
        Nothing
        energies


{-| Port of `advanceActiveSpeaker`: EMA-smoothed energy per present
peer (absentees evicted), the first talker claims focus at once, a
challenger needs a `margin` lead held for `holdMs`, and a silent
dominant coasts for `releaseMs` before focus moves on.
-}
advanceSpeaker : SpeakerConfig -> List ( String, Float ) -> Float -> Speaker -> Speaker
advanceSpeaker config samples dtMs prev =
    let
        step =
            if isNaN dtMs || dtMs < 0 then
                0

            else
                dtMs

        alpha =
            if step <= 0 then
                0

            else if config.smoothingMs <= 0 then
                1

            else
                clampUnit (1 - e ^ (-step / config.smoothingMs))

        energies =
            List.foldl
                (\( nick, raw ) acc ->
                    if Dict.size acc >= config.maxPeers || Dict.member nick acc then
                        acc

                    else
                        let
                            target =
                                clampUnit raw

                            before =
                                Dict.get nick prev.energies |> Maybe.withDefault 0
                        in
                        Dict.insert nick (clampUnit (before + alpha * (target - before))) acc
                )
                Dict.empty
                samples

        present nick =
            Dict.member nick energies

        ( dominant0, silent0 ) =
            case prev.dominant of
                Just d ->
                    if present d then
                        ( Just d, prev.silentMs )

                    else
                        ( Nothing, 0 )

                Nothing ->
                    ( Nothing, prev.silentMs )

        ( challenger0, challenge0 ) =
            case prev.challenger of
                Just c ->
                    if present c then
                        ( Just c, prev.challengeMs )

                    else
                        ( Nothing, 0 )

                Nothing ->
                    ( Nothing, prev.challengeMs )

        top =
            topPeer energies config.floor Nothing

        next =
            { prev | energies = energies }
    in
    case dominant0 of
        Nothing ->
            { next | dominant = Maybe.map Tuple.first top, challenger = Nothing, challengeMs = 0, silentMs = 0 }

        Just d ->
            let
                dEnergy =
                    Dict.get d energies |> Maybe.withDefault 0
            in
            if dEnergy < config.floor then
                let
                    silent =
                        silent0 + step
                in
                if silent >= config.releaseMs then
                    { next | dominant = Maybe.map Tuple.first top, challenger = Nothing, challengeMs = 0, silentMs = 0 }

                else
                    { next | dominant = Just d, challenger = challenger0, challengeMs = challenge0, silentMs = silent }

            else
                case topPeer energies config.floor (Just d) of
                    Just ( c, cEnergy ) ->
                        if cEnergy >= dEnergy + config.margin then
                            let
                                held =
                                    if Just c == challenger0 then
                                        challenge0 + step

                                    else
                                        step
                            in
                            if held >= config.holdMs then
                                { next | dominant = Just c, challenger = Nothing, challengeMs = 0, silentMs = 0 }

                            else
                                { next | dominant = Just d, challenger = Just c, challengeMs = held, silentMs = 0 }

                        else
                            { next | dominant = Just d, challenger = Nothing, challengeMs = 0, silentMs = 0 }

                    Nothing ->
                        { next | dominant = Just d, challenger = Nothing, challengeMs = 0, silentMs = 0 }


{-| Boolean speaking flags as energies (`energySamplesFromSpeaking`);
muted people never count.
-}
speakerSamples : List String -> Set String -> Set String -> List ( String, Float )
speakerSamples present speaking muted =
    List.map
        (\k ->
            ( k
            , if Set.member k speaking && not (Set.member k muted) then
                1

              else
                0
            )
        )
        present


{-| Advance on the shell clock: `dt` is the time since the previous
step (0 on the first), so repeated settles at one instant are
idempotent.
-}
stepSpeaker : Float -> List ( String, Float ) -> Speaker -> Speaker
stepSpeaker nowMs samples prev =
    let
        dt =
            if prev.at <= 0 || nowMs <= prev.at then
                0

            else
                nowMs - prev.at

        next =
            advanceSpeaker defaultSpeakerConfig samples dt prev
    in
    { next | at = max prev.at nowMs }



-- C5 · LAYOUT


type Layout
    = LayoutGrid
    | LayoutSpotlight


type StageSize
    = SizeCompact
    | SizeExpanded
    | SizeFullscreen


type StageView
    = ViewGrid
    | ViewSpotlight
    | ViewScreenshare


{-| A live share forces the screenshare view unless the person opted
out of that very share with the primary tile's grid button.
-}
resolveView : { layout : Layout, shareId : Maybe String, optOut : Maybe String } -> StageView
resolveView input =
    case input.shareId of
        Just id ->
            if input.optOut == Just id then
                layoutView input.layout

            else
                ViewScreenshare

        Nothing ->
            layoutView input.layout


layoutView : Layout -> StageView
layoutView layout =
    case layout of
        LayoutGrid ->
            ViewGrid

        LayoutSpotlight ->
            ViewSpotlight


viewWord : StageView -> String
viewWord v =
    case v of
        ViewGrid ->
            "grid"

        ViewSpotlight ->
            "spotlight"

        ViewScreenshare ->
            "screenshare"


layoutToggleLabel : Layout -> String
layoutToggleLabel layout =
    case layout of
        LayoutGrid ->
            "Switch to spotlight layout"

        LayoutSpotlight ->
            "Switch to grid layout"


nextStageSize : StageSize -> StageSize
nextStageSize size =
    case size of
        SizeCompact ->
            SizeExpanded

        SizeExpanded ->
            SizeFullscreen

        SizeFullscreen ->
            SizeCompact


{-| The stage-size button names the next size (oracle). -}
stageSizeLabel : StageSize -> String
stageSizeLabel size =
    case size of
        SizeCompact ->
            "Expand call stage"

        SizeExpanded ->
            "Fullscreen call stage"

        SizeFullscreen ->
            "Compact call stage"


sizeWord : StageSize -> String
sizeWord size =
    case size of
        SizeCompact ->
            "compact"

        SizeExpanded ->
            "expanded"

        SizeFullscreen ->
            "fullscreen"


{-| Grid columns by participant count (§2.6). -}
gridColumns : Int -> Int
gridColumns count =
    if count <= 1 then
        1

    else if count <= 4 then
        2

    else if count <= 9 then
        3

    else
        4


pageSize : Int
pageSize =
    16


pageCount : Int -> Int
pageCount count =
    max 1 ((count + pageSize - 1) // pageSize)


clampPage : Int -> Int -> Int
clampPage count page =
    clamp 0 (pageCount count - 1) page


pageSlice : Int -> List a -> List a
pageSlice page items =
    items
        |> List.drop (clampPage (List.length items) page * pageSize)
        |> List.take pageSize


{-| Stable tile order (LiveKit visually-stable rule): previous order
kept, leavers dropped, joiners appended, self pinned first. The only
reorder is across the page-1 boundary: a dominant speaker beyond page
1 swaps with the last page-1 tile that is not self, pinned or
speaking. Nothing on page 1 ever moves for speaking alone.
-}
reconcileOrder :
    { selfKey : String
    , roster : List String
    , dominant : Maybe String
    , pinned : Maybe String
    , speaking : Set String
    }
    -> List String
    -> List String
reconcileOrder input previous =
    let
        present =
            Set.fromList (input.selfKey :: input.roster)

        kept =
            dedupe (List.filter (\k -> Set.member k present && k /= input.selfKey) previous)

        keptSet =
            Set.fromList kept

        joined =
            input.roster
                |> List.filter (\k -> k /= input.selfKey && not (Set.member k keptSet) && not (String.isEmpty k))
                |> dedupe

        ordered =
            (if String.isEmpty input.selfKey then
                []

             else
                [ input.selfKey ]
            )
                ++ kept
                ++ joined
    in
    case input.dominant |> Maybe.andThen (\d -> indexOf d ordered |> Maybe.map (Tuple.pair d)) of
        Just ( d, i ) ->
            if i >= pageSize then
                let
                    swappable k =
                        k /= input.selfKey && Just k /= input.pinned && not (Set.member k input.speaking) && k /= d

                    target =
                        List.take pageSize ordered
                            |> List.indexedMap Tuple.pair
                            |> List.filter (\( _, k ) -> swappable k)
                            |> List.reverse
                            |> List.head
                in
                case target of
                    Just ( j, k ) ->
                        List.indexedMap
                            (\idx item ->
                                if idx == j then
                                    d

                                else if idx == i then
                                    k

                                else
                                    item
                            )
                            ordered

                    Nothing ->
                        ordered

            else
                ordered

        Nothing ->
            ordered


dedupe : List String -> List String
dedupe items =
    List.foldl
        (\k ( seen, acc ) ->
            if Set.member k seen then
                ( seen, acc )

            else
                ( Set.insert k seen, k :: acc )
        )
        ( Set.empty, [] )
        items
        |> Tuple.second
        |> List.reverse


indexOf : a -> List a -> Maybe Int
indexOf x items =
    items
        |> List.indexedMap Tuple.pair
        |> List.filter (\( _, y ) -> y == x)
        |> List.head
        |> Maybe.map Tuple.first


{-| Spotlight primary: pinned, else the dominant speaker, else self. -}
spotlightPrimary : { pinned : Maybe String, dominant : Maybe String, selfKey : String, present : List String } -> String
spotlightPrimary input =
    [ input.pinned, input.dominant ]
        |> List.filterMap identity
        |> List.filter (\k -> List.member k input.present)
        |> List.head
        |> Maybe.withDefault input.selfKey



-- C5 · TILES


type TileKind
    = TilePerson
    | TileScreen


{-| One participant or share tile. `id` is the ports binding key
(`self`, `self-screen`, `peer:{nick}`, `screen:{nick}`).
-}
type alias Tile =
    { id : String
    , key : String
    , name : String
    , kind : TileKind
    , self : Bool
    , video : Bool
    , speaking : Bool
    , muted : Bool
    , hand : Bool
    , cameraOff : Bool
    , videoPaused : Bool
    , deafened : Bool
    , quality : Maybe Int
    , pinned : Bool
    , role : Maybe String
    }


{-| Camera off: a peer that joined with video but has no live frames
(oracle `cameraOff`; self never shows it; a bandwidth stop reads
"Video paused" instead).
-}
cameraOff : Peer -> Bool
cameraOff peer =
    peer.kind == KindVideo && not peer.hasVideo && not peer.videoPaused


{-| Person tiles in `order`, then share tiles (local first, then
remote `kind = screen` peers in order). A remote sharer's one engine
stream is the screen, so their person tile falls back to the avatar.
-}
buildTiles :
    { ourNick : String
    , order : List String
    , media : MediaState
    , peers : Dict String Peer
    , local : Local
    , selfMuted : Bool
    , pinned : Maybe String
    , displayName : String -> String
    , roleOf : String -> Maybe String
    }
    -> { people : List Tile, shares : List Tile }
buildTiles input =
    let
        selfKey =
            String.toLower input.ourNick

        localSharing =
            input.local.share == ShareOn

        blankTile =
            { id = ""
            , key = ""
            , name = ""
            , kind = TileScreen
            , self = False
            , video = True
            , speaking = False
            , muted = False
            , hand = False
            , cameraOff = False
            , videoPaused = False
            , deafened = False
            , quality = Nothing
            , pinned = False
            , role = Nothing
            }

        person key =
            let
                isSelf =
                    key == selfKey

                peer =
                    if isSelf then
                        Nothing

                    else
                        Dict.get key input.peers

                peerFlag f =
                    Maybe.map f peer == Just True

                muted =
                    Set.member key input.media.muted
                        || (isSelf && input.selfMuted)
                        || peerFlag .muted

                speakingRaw =
                    Set.member key input.media.speaking || peerFlag .speaking
            in
            { id =
                if isSelf then
                    "self"

                else
                    "peer:" ++ key
            , key = key
            , name =
                if isSelf then
                    input.ourNick

                else
                    input.displayName key
            , kind = TilePerson
            , self = isSelf
            , video =
                if isSelf then
                    input.local.camera && not localSharing

                else
                    peerFlag (\p -> p.hasVideo && p.kind == KindVideo && not p.videoPaused)
            , speaking = speakingRaw && not muted
            , muted = muted
            , hand = Set.member key input.media.hands
            , cameraOff = peerFlag cameraOff
            , videoPaused = peerFlag .videoPaused
            , deafened = isSelf && input.local.deafened
            , quality = Maybe.andThen .quality peer
            , pinned = input.pinned == Just key
            , role = input.roleOf key
            }

        localShare =
            if localSharing && not (String.isEmpty selfKey) then
                [ { blankTile | id = "self-screen", key = selfKey, name = input.ourNick ++ "'s screen", self = True } ]

            else
                []

        remoteShares =
            input.order
                |> List.filter
                    (\k ->
                        k
                            /= selfKey
                            && (Maybe.map (\p -> p.kind == KindScreen && p.hasVideo) (Dict.get k input.peers) == Just True)
                    )
                |> List.map (\k -> { blankTile | id = "screen:" ++ k, key = k, name = input.displayName k ++ "'s screen" })
    in
    { people = List.map person input.order, shares = localShare ++ remoteShares }


{-| Tile aria (`ParticipantTile` order): nick, (you), hand raised,
speaking, muted, camera off, quality. A share tile is "{nick}'s
screen".
-}
tileAria : Tile -> String
tileAria tile =
    case tile.kind of
        TileScreen ->
            tile.name

        TilePerson ->
            String.join ", "
                (tile.name
                    :: List.filterMap identity
                        [ when tile.self "(you)"
                        , when tile.hand "hand raised"
                        , when tile.speaking "speaking"
                        , when tile.muted "muted"
                        , when tile.cameraOff "camera off"
                        , Maybe.map (\q -> qualityLabel q ++ " connection") tile.quality
                        ]
                )
