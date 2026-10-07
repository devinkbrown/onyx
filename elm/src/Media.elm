module Media exposing
    ( CallHub
    , CallLifecycle(..)
    , CallOutcome(..)
    , HubPresentation(..)
    , MediaState
    , TranscriptEntry
    , EngineSnapshot
    , applyEngineSnapshot
    , blankCallHub
    , blankMediaState
    , callOutcomeCopy
    , classifyHubPresentation
    , decodeEngineSnapshot
    , foldMediaLine
    , validEngineChannel
    , validEngineNick
    , hubRoomLabel
    , maxMediaChannels
    , maxParticipants
    , maxReactionEntries
    , maxReactionLength
    , maxTranscriptEntries
    , maxTranscriptTextLength
    , mediaBreakout
    , mediaJoin
    , mediaLeave
    , mediaMute
    , mediaOffer
    , mediaReact
    , mediaRoster
    , MediaReaction
    )

{-| Voice/video/screen control plane — Elm port of the `store.ts` NOTE
MEDIA fold and the `MEDIA JOIN/OFFER/LEAVE/BREAKOUT` builders
(protocol §12).

Pure call-state only: roster, speaking, mute, raised hands, and live
captions/transcripts with the oracle's bounds. Media bytes never flow
over the socket; RTP/WebRTC legs, the WASM codecs, and the DOM fan-out
events (`onyx:caption`, `onyx:voice-reaction`, `onyx:stream-start/stop`)
stay behind ports. The lifecycle feed arrives as engine snapshots
through `voiceCallHub`, validated fail-closed below.

Nicks store lowercase (all membership tests are case-insensitive in
the oracle; committed vectors pin the lowercase roster). Transcript
entries carry the server `time` tag when present (`Nothing`
otherwise — the fold stays pure with no clock fallback).

-}

import Dict exposing (Dict)
import EventReplay
import Json.Decode as Decode
import Set exposing (Set)
import Wire


maxMediaChannels : Int
maxMediaChannels =
    32


maxParticipants : Int
maxParticipants =
    256


maxTranscriptEntries : Int
maxTranscriptEntries =
    200


maxTranscriptTextLength : Int
maxTranscriptTextLength =
    4096


maxReactionLength : Int
maxReactionLength =
    64


{-| Reaction log cap. The oracle fires one DOM event per accepted
reaction and keeps no list; Elm keeps the newest 32 so the hub can
render them without an unbounded log.
-}
maxReactionEntries : Int
maxReactionEntries =
    32


{-| One accepted voice reaction: the lowercased channel key plus
the lowercased roster nick and the validated emoji, mirroring the
oracle's `onyx:voice-reaction` detail.
-}
type alias MediaReaction =
    { channel : String
    , nick : String
    , emoji : String
    }


maxTargetLength : Int
maxTargetLength =
    512


maxSenderLength : Int
maxSenderLength =
    256


type alias TranscriptEntry =
    { nick : String
    , text : String
    , time : Maybe String
    }


type alias MediaState =
    { participants : Dict String (List String)
    , speaking : Set String
    , muted : Set String
    , hands : Set String
    , transcripts : Dict String (List TranscriptEntry)
    , reactions : List MediaReaction
    }


blankMediaState : MediaState
blankMediaState =
    { participants = Dict.empty
    , speaking = Set.empty
    , muted = Set.empty
    , hands = Set.empty
    , transcripts = Dict.empty
    , reactions = []
    }


{-| Fold one MEDIA standard-reply line. Both the legacy service shape
and the EVENT-plane reshape arrive as
`['MEDIA', '#chan', VERB, nick?, ...extra]` straight in `msg.params`
(the standard-reply command occupies params[0]; there is no `<me>`
target on this plane).
`knownChannels` holds lowercase joined channels; unknown channels
never allocate state. Channel sigils follow the advertised chantypes.
-}
foldMediaLine : MediaState -> Set String -> String -> Wire.IrcMessage -> MediaState
foldMediaLine state knownChannels chantypes message =
    case message.params of
        _ :: channel :: verbRaw :: rest ->
            let
                verb =
                    String.toUpper verbRaw
            in
            if verb == "CAPTION" || verb == "TRANSCRIPT" then
                foldCaption state chantypes channel message.tags rest

            else
                foldPresence state knownChannels chantypes channel verb rest message

        _ ->
            state


foldCaption : MediaState -> String -> String -> Dict.Dict String String -> List String -> MediaState
foldCaption state chantypes channel tags rest =
    case rest of
        nick :: _ ->
            let
                rawText =
                    String.join " " rest
                        |> String.dropLeft (String.length nick + 1)

                text =
                    String.left maxTranscriptTextLength rawText
            in
            if not (validChannel chantypes channel) then
                state

            else if validTypingToken nick maxSenderLength == Nothing then
                state

            else if EventReplay.utf16Length rawText > maxTranscriptTextLength then
                state

            else if String.isEmpty text then
                state

            else
                let
                    key =
                        String.toLower channel

                    combined =
                        Maybe.withDefault [] (Dict.get key state.transcripts)
                            ++ [ { nick = nick, text = text, time = Dict.get "time" tags } ]
                in
                if not (Dict.member key state.transcripts) && Dict.size state.transcripts >= maxMediaChannels then
                    state

                else
                    { state
                        | transcripts =
                            Dict.insert key
                                (List.drop (max 0 (List.length combined - maxTranscriptEntries)) combined)
                                state.transcripts
                    }

        [] ->
            state


foldPresence : MediaState -> Set String -> String -> String -> String -> List String -> Wire.IrcMessage -> MediaState
foldPresence state knownChannels chantypes channel verb rest message =
    let
        actorRaw =
            List.head rest |> Maybe.withDefault ""

        isPresence =
            verb == "JOIN" || verb == "LEAVE" || verb == "ROSTER" || verb == "MUTE" || verb == "UNMUTE" || verb == "SPEAKING" || verb == "SILENT" || verb == "HAND" || verb == "REACT" || isE2eeVerb verb

        actor =
            if isPresence then
                case validTypingToken actorRaw maxSenderLength of
                    Just nick ->
                        nick

                    Nothing ->
                        case validTypingToken (Maybe.withDefault "" message.nick) maxSenderLength of
                            Just fallback ->
                                fallback

                            Nothing ->
                                ""
            else
                ""
    in
    if not (validChannel chantypes channel) then
        state

    else if not (Set.member (String.toLower channel) knownChannels) then
        state

    else if isPresence && String.isEmpty actor then
        state

    else
        applyVerb state channel verb actor (List.drop 1 rest)


applyVerb : MediaState -> String -> String -> String -> List String -> MediaState
applyVerb state channel verb actor tail =
    let
        key =
            String.toLower channel

        lowered =
            String.toLower actor

        arg =
            List.head tail |> Maybe.withDefault ""

        present =
            List.member lowered (Maybe.withDefault [] (Dict.get key state.participants))
    in
    if (verb == "JOIN" || verb == "ROSTER") && not (String.isEmpty actor) then
        let
            current =
                Maybe.withDefault [] (Dict.get key state.participants)
        in
        if not (Dict.member key state.participants) && Dict.size state.participants >= maxMediaChannels then
            state

        else if not present && List.length current >= maxParticipants then
            state

        else if present then
            state

        else
            { state | participants = Dict.insert key (current ++ [ lowered ]) state.participants }

    else if verb == "LEAVE" && not (String.isEmpty actor) then
        let
            remaining =
                List.filter (\n -> n /= lowered) (Maybe.withDefault [] (Dict.get key state.participants))

            participants =
                if List.isEmpty remaining then
                    Dict.remove key state.participants

                else
                    Dict.insert key remaining state.participants
        in
        { state
            | participants = participants
            , speaking = Set.remove lowered state.speaking
            , muted = Set.remove lowered state.muted
            , hands = Set.remove lowered state.hands
        }

    else if (verb == "SPEAKING" || verb == "SILENT") && not (String.isEmpty actor) then
        -- SILENT always clears; SPEAKING applies only to rostered peers
        -- (cross-node audio never reaches local VAD).
        if verb == "SILENT" || present then
            { state
                | speaking =
                    if verb == "SPEAKING" then
                        Set.insert lowered state.speaking

                    else
                        Set.remove lowered state.speaking
            }

        else
            state

    else if (verb == "MUTE" || verb == "UNMUTE") && not (String.isEmpty actor) then
        if verb == "MUTE" then
            if present && (Set.size state.muted < maxParticipants || Set.member lowered state.muted) then
                { state | muted = Set.insert lowered state.muted }

            else
                state

        else
            { state | muted = Set.remove lowered state.muted }

    else if verb == "HAND" && not (String.isEmpty actor) then
        if String.toLower arg == "up" then
            if present && (Set.size state.hands < maxParticipants || Set.member lowered state.hands) then
                { state | hands = Set.insert lowered state.hands }

            else
                state

        else
            { state | hands = Set.remove lowered state.hands }

    else if verb == "REACT" && not (String.isEmpty actor) then
        -- Membership-gated, emoji-validated like the oracle's
        -- `onyx:voice-reaction` fan-out; recorded newest-last under
        -- the reaction cap (the DOM event itself stays engine-side).
        case validTypingToken arg maxReactionLength of
            Nothing ->
                state

            Just emoji ->
                if not present then
                    state

                else
                    let
                        combined =
                            state.reactions
                                ++ [ { channel = key, nick = lowered, emoji = emoji } ]
                    in
                    { state
                        | reactions =
                            List.drop (max 0 (List.length combined - maxReactionEntries)) combined
                    }

    else
        state


isE2eeVerb : String -> Bool
isE2eeVerb verb =
    verb == "E2EE-HANDSHAKE" || verb == "E2EE-GROUPKEY" || verb == "E2EE-DETACH"


validChannel : String -> String -> Bool
validChannel chantypes channel =
    case String.uncons channel of
        Nothing ->
            False

        Just ( first, _ ) ->
            String.contains (String.fromChar first) chantypes
                && validWireToken channel maxTargetLength
                && not (String.contains "," channel)


validWireToken : String -> Int -> Bool
validWireToken value maxLength =
    not (String.isEmpty value)
        && String.length value <= maxLength
        && not (String.any (\c -> c <= ' ' || Char.toCode c == 127) value)


validTypingToken : String -> Int -> Maybe String
validTypingToken value maxLength =
    if not (validWireToken value maxLength) then
        Nothing

    else if String.startsWith ":" value || String.contains "," value then
        Nothing

    else
        Just value



-- ── Builders ─────────────────────────────────────────────────────────


wireToken : String -> Maybe String
wireToken value =
    if validWireToken value 512 then
        Just value

    else
        Nothing


mediaJoin : String -> String -> Maybe String
mediaJoin channel kind =
    case ( wireToken channel, String.toLower (String.trim kind) ) of
        ( Just c, "voice" ) ->
            Just (Wire.formatIrcLine "MEDIA" [ "JOIN", c, "voice" ])

        ( Just c, "video" ) ->
            Just (Wire.formatIrcLine "MEDIA" [ "JOIN", c, "video" ])

        ( Just c, "screen" ) ->
            Just (Wire.formatIrcLine "MEDIA" [ "JOIN", c, "screen" ])

        _ ->
            Nothing


mediaLeave : String -> Maybe String
mediaLeave channel =
    Maybe.map (\c -> Wire.formatIrcLine "MEDIA" [ "LEAVE", c ]) (wireToken channel)


{-| MUTE/UNMUTE takes the media kind: `voice` (mic mute, mirroring
`MUTE`/`UNMUTE` and PTT) or `video` (camera-off, mirroring
`VIDEO_LEAVE` which stays in the voice room). Anything else is
rejected — the oracle only ever sends these two kinds.
-}
mediaMute : String -> String -> Bool -> Maybe String
mediaMute channel kind muted =
    case ( wireToken channel, String.toLower (String.trim kind) ) of
        ( Just c, "voice" ) ->
            Just (Wire.formatIrcLine "MEDIA" [ muteVerb muted, c, "voice" ])

        ( Just c, "video" ) ->
            Just (Wire.formatIrcLine "MEDIA" [ muteVerb muted, c, "video" ])

        _ ->
            Nothing


muteVerb : Bool -> String
muteVerb muted =
    if muted then
        "MUTE"

    else
        "UNMUTE"


{-| ROSTER re-requests the participant list (mirroring the engine's
post-join reconcile). -}
mediaRoster : String -> Maybe String
mediaRoster channel =
    Maybe.map (\c -> Wire.formatIrcLine "MEDIA" [ "ROSTER", c ]) (wireToken channel)


{-| REACT sends one voice reaction (mirroring `sendCallReaction`:
trim, reject empty, send as-is — no outbound cap; the 64-char bound
is enforced inbound by every peer's fold, ours included).
-}
mediaReact : String -> String -> Maybe String
mediaReact channel emoji =
    case ( wireToken channel, String.trim emoji ) of
        ( Just c, trimmed ) ->
            if String.isEmpty trimmed then
                Nothing

            else
                Just (Wire.formatIrcLine "MEDIA" [ "REACT", c, trimmed ])

        _ ->
            Nothing


mediaOffer : String -> List String -> Bool -> Maybe String
mediaOffer channel codecs webrtc =
    if List.isEmpty codecs then
        Nothing

    else if not (List.all validCodec codecs) then
        Nothing

    else
        case wireToken channel of
            Nothing ->
                Nothing

            Just c ->
                Just
                    (Wire.formatIrcLine "MEDIA"
                        ([ "OFFER", c, String.join "," codecs ]
                            ++ (if webrtc then
                                    [ "transport=webrtc" ]

                                else
                                    []
                               )
                        )
                    )


validCodec : String -> Bool
validCodec codec =
    codec == "cadencevox" || codec == "cadencevis" || codec == "raw"


{-| BREAKOUT takes the bare room name: strip whichever channel sigil
the server advertises rather than only `#`.
-}
mediaBreakout : String -> String -> String -> Maybe String
mediaBreakout chantypes channel target =
    case ( wireToken channel, wireToken target ) of
        ( Just c, Just t ) ->
            let
                bare =
                    case String.uncons t of
                        Just ( first, rest ) ->
                            if String.contains (String.fromChar first) chantypes then
                                rest

                            else
                                t

                        Nothing ->
                            t
            in
            if String.isEmpty bare then
                Nothing

            else
                Just (Wire.formatIrcLine "MEDIA" [ "BREAKOUT", c, bare ])

        _ ->
            Nothing


{-| Voice-call lifecycle for the calls hub — Elm port of `CallState` in
`src/lib/cadence-media/types.ts` (`idle | ringing_out | ringing_in |
in_call`). The engine bridge (RTP/WebRTC legs, `handleMediaMessage`)
lands with the engine itself; until then the hub rests at `Idle` and
stays honest about it.
-}
type CallLifecycle
    = Idle
    | RingingOut
    | RingingIn
    | InCall


{-| Hub presentation — Elm port of `CallsHubPresentation`. Ringing and
provisional states are never labeled established.
-}
type HubPresentation
    = HubIdle
    | HubRingingIn
    | HubRingingOut
    | HubProvisional
    | HubEstablished


{-| What happened to the most recent call, when known — Elm port of
`CallOutcome`. Rendered only while idle; a live call always wins over
history, and the hub never invents this.
-}
type CallOutcome
    = CallEnded
    | CallFailed
    | CallDropped


{-| Everything the hub renders. `startedAt` is the epoch ms the call
became established, or `Nothing` while idle / ringing / provisional
(media path not yet started).
-}
type alias CallHub =
    { lifecycle : CallLifecycle
    , channel : Maybe String
    , withPeer : String
    , startedAt : Maybe Int
    , outcome : Maybe CallOutcome
    }


{-| Resting hub: no call, no history, no claims. -}
blankCallHub : CallHub
blankCallHub =
    { lifecycle = Idle
    , channel = Nothing
    , withPeer = ""
    , startedAt = Nothing
    , outcome = Nothing
    }


{-| Pure presentation classifier — Elm port of
`classifyCallsHubPresentation`. Tests and UI share the same truth
table: ringing always wins over any timestamp, and only an `InCall`
with a start time is established.
-}
classifyHubPresentation : CallLifecycle -> Maybe Int -> HubPresentation
classifyHubPresentation lifecycle startedAt =
    case lifecycle of
        RingingIn ->
            HubRingingIn

        RingingOut ->
            HubRingingOut

        InCall ->
            case startedAt of
                Just _ ->
                    HubEstablished

                Nothing ->
                    HubProvisional

        Idle ->
            HubIdle


{-| Honest outcome copy — Elm port of `callOutcomeCopy`. Plain language,
no protocol detail, no blame.
-}
callOutcomeCopy : CallOutcome -> { title : String, detail : String }
callOutcomeCopy outcome =
    case outcome of
        CallEnded ->
            { title = "That call ended."
            , detail = "Start the next one from a room whenever you are ready."
            }

        CallFailed ->
            { title = "Couldn’t start the call."
            , detail = "Check the room’s call controls and try again."
            }

        CallDropped ->
            { title = "The connection dropped."
            , detail = "Rejoin from the room — your place in the conversation is kept."
            }


{-| Room-or-peer label for the hub status line: the trimmed channel
first, then the peer, else nothing. Mirrors the hub's `roomLabel`.
-}
hubRoomLabel : CallHub -> Maybe String
hubRoomLabel hub =
    case Maybe.map String.trim hub.channel of
        Just channel ->
            if String.isEmpty channel then
                peerLabel hub

            else
                Just channel

        Nothing ->
            peerLabel hub


peerLabel : CallHub -> Maybe String
peerLabel hub =
    let
        peer =
            String.trim hub.withPeer
    in
    if String.isEmpty peer then
        Nothing

    else
        Just peer


{-| A validated engine nick (mirroring `validMediaNick`: non-empty,
≤256 chars, no leading colon, no comma, no C0 controls or DEL). -}
validEngineNick : String -> Bool
validEngineNick nick =
    validTypingToken nick 256 /= Nothing


{-| A validated engine channel (mirroring `validMediaChannel`:
`#`/`&` open, ≤512 chars, no comma, no C0 controls or DEL). -}
validEngineChannel : String -> Bool
validEngineChannel channel =
    validChannel "#&" channel


{-| One engine lifecycle snapshot as pushed through `voiceCallHub`.
`startedAt` is the epoch ms the call became established (`Nothing`
while ringing or provisional); `outcome` is bridge-derived from
join/drop evidence and only ever sticks while idle. -}
type alias EngineSnapshot =
    { lifecycle : CallLifecycle
    , nick : String
    , channel : Maybe String
    , startedAt : Maybe Int
    , outcome : Maybe CallOutcome
    }


{-| Fail-closed decode of a bridge snapshot. An unknown lifecycle drops
the whole snapshot (it cannot be placed); an unknown outcome degrades
to `Nothing` (the hub never invents one); a corrupt `startedAt`
degrades to `Nothing` (provisional — dropping the snapshot would hide
a live call, which is worse). -}
decodeEngineSnapshot : Decode.Value -> Maybe EngineSnapshot
decodeEngineSnapshot raw =
    Decode.decodeValue snapshotDecoder raw
        |> Result.toMaybe


snapshotDecoder : Decode.Decoder EngineSnapshot
snapshotDecoder =
    Decode.map5 EngineSnapshot
        (Decode.field "state" lifecycleDecoder)
        (Decode.oneOf [ Decode.field "nick" Decode.string, Decode.succeed "" ])
        (Decode.oneOf
            [ Decode.field "channel" (Decode.nullable Decode.string)
            , Decode.succeed Nothing
            ]
        )
        (Decode.oneOf
            [ Decode.field "startedAt" (Decode.nullable epochDecoder)
            , Decode.succeed Nothing
            ]
        )
        (Decode.oneOf
            [ Decode.field "outcome" (Decode.nullable Decode.string)
                |> Decode.map (Maybe.andThen decodeOutcome)
            , Decode.succeed Nothing
            ]
        )


lifecycleDecoder : Decode.Decoder CallLifecycle
lifecycleDecoder =
    Decode.string
        |> Decode.andThen
            (\state ->
                case state of
                    "idle" ->
                        Decode.succeed Idle

                    "ringing_in" ->
                        Decode.succeed RingingIn

                    "ringing_out" ->
                        Decode.succeed RingingOut

                    "in_call" ->
                        Decode.succeed InCall

                    _ ->
                        Decode.fail ("unknown call lifecycle: " ++ state)
            )


{-| Epoch ms as whole milliseconds inside the exact-double range
(non-negative integers up to 2^53-1 — the field only ever asks
`Just` vs `Nothing`, never arithmetic, so the 32-bit `Int` cap from
the binary u32 parses does not apply; a genuine `Date.now()` is
~1.7e12 and must decode). -}
epochDecoder : Decode.Decoder Int
epochDecoder =
    Decode.float
        |> Decode.andThen
            (\epoch ->
                if epoch >= 0 && epoch <= 9007199254740991 && epoch == toFloat (round epoch) then
                    Decode.succeed (round epoch)

                else
                    Decode.fail "call epoch out of range"
            )


decodeOutcome : String -> Maybe CallOutcome
decodeOutcome outcome =
    case outcome of
        "ended" ->
            Just CallEnded

        "failed" ->
            Just CallFailed

        "dropped" ->
            Just CallDropped

        _ ->
            Nothing


{-| Fold one validated snapshot over the hub (mirroring the
`onCallState` feed: `idle` tears everything down; any other state
keeps the previous channel when the snapshot carries none — a null
channel never wipes an established one — and only an idle hub keeps
an outcome). -}
applyEngineSnapshot : CallHub -> EngineSnapshot -> CallHub
applyEngineSnapshot prev snap =
    case snap.lifecycle of
        Idle ->
            { blankCallHub | outcome = snap.outcome }

        _ ->
            { lifecycle = snap.lifecycle
            , channel =
                case snap.channel of
                    Just channel ->
                        if validEngineChannel channel then
                            Just channel

                        else
                            prev.channel

                    Nothing ->
                        prev.channel
            , withPeer =
                if validEngineNick snap.nick then
                    snap.nick

                else
                    ""
            , startedAt = snap.startedAt
            , outcome = Nothing
            }
