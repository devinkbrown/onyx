module CallUi exposing
    ( Announcer
    , Banner(..)
    , FingerprintState(..)
    , Person
    , PipState(..)
    , RoomStatus
    , Security
    , SecurityFeed
    , SecurityIcon(..)
    , SecurityLevel(..)
    , SecurityTone(..)
    , SfuInput
    , SfuView
    , StageDensity(..)
    , announceStep
    , bannerFor
    , blankAnnouncer
    , blankSecurityFeed
    , callRoster
    , callTarget
    , chipAria
    , chipLabel
    , chipTitle
    , currentCallIn
    , decodeSecurityFeed
    , fingerprintGroups
    , formatDuration
    , iconWord
    , inviteTitle
    , joinMutedDefault
    , levelWord
    , mediaPathCopy
    , nameList
    , peopleLabel
    , personAria
    , privacyTitle
    , railPresence
    , resolveSecurity
    , roleWord
    , roomPresentation
    , roomStatus
    , rosterFor
    , sameTarget
    , settle
    , sfuView
    , stageDensity
    , stagePeople
    , stageStatus
    , toneWord
    , validFingerprint
    , voiceRoster
    )

{-| v3/calls-c1 — pure call-surface logic for calls slices C1–C3
(`elm/design/calls/CALLS_DESIGN.md` §2.1–2.5, §2.12, §3.3, §5).

  - C1 presence: sidebar count, room-header chip (port of
    `buildVoiceRoomStatus` + the `PresenceRibbon` chip label/aria),
    and the pre-join banner (invite / failed).
  - C2 voice-only stage: status line, person cells, timer, people
    count, and the roster-delta announcer (port of
    `CallStatusAnnouncer`).
  - C3 trust: the security resolver (port of `resolveCallSecurity`
    with the C7 padlock-honesty gate folded in), privacy-sheet copy
    (`resolveCallPrivacy`), SFU topology copy (`sfuCascadeView`) and
    the fail-closed decode of the extra `voiceCallHub` snapshot
    fields.

Everything is DOM-free and takes plain records (extensible where it
reads the model), so `App` can call it without an import cycle.

-}

import Dict exposing (Dict)
import Json.Decode as Decode
import Media exposing (CallHub, CallLifecycle(..), CallOutcome(..), HubPresentation(..), MediaState)
import Set exposing (Set)



-- SHARED


{-| Join muted is the shipped default (spec §2.3 / §2.11; product
question §7.2 is unanswered — provisional). The banner promise "your
microphone starts off until you unmute" depends on it.
-}
joinMutedDefault : Bool
joinMutedDefault =
    True


{-| Case-insensitive target comparison (blank never matches). -}
sameTarget : Maybe String -> String -> Bool
sameTarget current target =
    let
        wanted =
            String.toLower (String.trim target)
    in
    case current of
        Just name ->
            not (String.isEmpty wanted) && String.toLower (String.trim name) == wanted

        Nothing ->
            False


{-| The call's target: its channel, else its DM peer. -}
callTarget : CallHub -> Maybe String
callTarget =
    Media.hubRoomLabel


{-| Lowercased voice roster for one channel, join order. -}
rosterFor : MediaState -> String -> List String
rosterFor media channel =
    Dict.get (String.toLower channel) media.participants
        |> Maybe.withDefault []


{-| Lowercased roster of the live call itself: the channel roster,
or the DM peer for a direct call (DMs have no MEDIA roster).
-}
callRoster : MediaState -> CallHub -> List String
callRoster media hub =
    case hub.channel of
        Just channel ->
            rosterFor media channel

        Nothing ->
            if String.isEmpty (String.trim hub.withPeer) then
                []

            else
                [ String.toLower (String.trim hub.withPeer) ]


{-| This room's call presentation: the hub presentation when the call
targets this room, idle otherwise (ringing/provisional elsewhere
never paints here — `roomCallPresentation`).
-}
roomPresentation : CallHub -> String -> HubPresentation
roomPresentation hub room =
    if sameTarget (callTarget hub) room then
        Media.classifyHubPresentation hub.lifecycle hub.startedAt

    else
        HubIdle


{-| In this room's media session (`in_call`, provisional or
established — `currentVoiceCall`).
-}
currentCallIn : CallHub -> String -> Bool
currentCallIn hub room =
    hub.lifecycle == InCall && sameTarget (callTarget hub) room



-- C1 · PRESENCE


type PipState
    = PipFaint
    | PipLive
    | PipProvisional


{-| Sidebar row count (§2.1): nothing at zero; faint pip when you are
not in it; accent when your call here is established; warn while
yours is provisional/ringing.
-}
railPresence : MediaState -> CallHub -> String -> Maybe { count : Int, pip : PipState, aria : String }
railPresence media hub room =
    let
        count =
            List.length (rosterFor media room)

        n =
            String.fromInt count
    in
    if count <= 0 then
        Nothing

    else
        case roomPresentation hub room of
            HubEstablished ->
                Just { count = count, pip = PipLive, aria = n ++ " in voice, current call" }

            HubIdle ->
                Just { count = count, pip = PipFaint, aria = n ++ " in voice" }

            _ ->
                Just { count = count, pip = PipProvisional, aria = n ++ " in voice, current call" }


{-| Display-cased voice roster for the header chip (mirroring
`voiceParticipants`: dedupe, keep only people still in the room
when the member list is known, sort case-insensitively).
-}
voiceRoster : Dict String { a | nick : String } -> List String -> List String
voiceRoster members roster =
    let
        known =
            not (Dict.isEmpty members)

        step lower ( seen, acc ) =
            if Set.member lower seen then
                ( seen, acc )

            else if known && not (Dict.member lower members) then
                ( seen, acc )

            else
                ( Set.insert lower seen
                , (Dict.get lower members |> Maybe.map .nick |> Maybe.withDefault lower) :: acc
                )
    in
    List.foldl step ( Set.empty, [] ) (List.map String.toLower roster)
        |> Tuple.second
        |> List.sortBy String.toLower


type alias RoomStatus =
    { label : String
    , aria : String
    }


{-| Port of `buildVoiceRoomStatus` (local health narrowed to the
mute flag — camera/share/deafen/captions land with C4/C8).
-}
roomStatus :
    { participants : List String
    , speaking : Set String
    , raised : Set String
    , muted : Set String
    , currentCall : Bool
    , localMuted : Bool
    }
    -> RoomStatus
roomStatus input =
    let
        lowered set =
            Set.map String.toLower set

        has set nick =
            Set.member (String.toLower nick) (lowered set)

        speakers =
            List.filter (has input.speaking) input.participants

        raised =
            List.filter (has input.raised) input.participants

        mutedPeers =
            List.filter (has input.muted) input.participants

        ( firstLabel, firstAria ) =
            case ( speakers, raised ) of
                ( [ one ], _ ) ->
                    ( [ one ++ " speaking" ], [ one ++ " is speaking" ] )

                ( _ :: _ :: _, _ ) ->
                    ( [ String.fromInt (List.length speakers) ++ " speaking" ]
                    , [ String.fromInt (List.length speakers) ++ " people are speaking" ]
                    )

                ( [], [ one ] ) ->
                    ( [ one ++ " raised" ], [ one ++ " has a hand raised" ] )

                ( [], _ :: _ :: _ ) ->
                    ( [ String.fromInt (List.length raised) ++ " raised" ]
                    , [ String.fromInt (List.length raised) ++ " people have hands raised" ]
                    )

                ( [], [] ) ->
                    if input.currentCall then
                        ( [ "listening" ], [ "you are listening" ] )

                    else
                        ( [], [] )

        ( healthLabel, healthAria ) =
            if input.currentCall && input.localMuted then
                ( [ "muted" ], [ "your microphone is muted" ] )

            else if not input.currentCall && not (List.isEmpty mutedPeers) && List.isEmpty speakers && List.isEmpty raised then
                let
                    n =
                        List.length mutedPeers
                in
                ( [ String.fromInt n ++ " muted" ]
                , [ String.fromInt n
                        ++ (if n == 1 then
                                " person is"

                            else
                                " people are"
                           )
                        ++ " muted"
                  ]
                )

            else
                ( [], [] )
    in
    { label = String.join " · " (firstLabel ++ healthLabel)
    , aria = String.join ", " (firstAria ++ healthAria)
    }


{-| Chip text: "N in voice · status". -}
chipLabel : Int -> RoomStatus -> String
chipLabel count status =
    if String.isEmpty status.label then
        String.fromInt count ++ " in voice"

    else
        String.fromInt count ++ " in voice · " ++ status.label


{-| Chip aria (§2.2): "current call" when you are in it; otherwise
the trailing "; join voice" verb.
-}
chipAria : String -> Int -> Bool -> RoomStatus -> String
chipAria channel count currentCall status =
    let
        noun =
            if count == 1 then
                "person"

            else
                "people"

        statusText =
            if String.isEmpty status.aria then
                ""

            else
                ", " ++ status.aria
    in
    if currentCall then
        String.fromInt count ++ " " ++ noun ++ " in voice in " ++ channel ++ ", current call" ++ statusText

    else
        String.fromInt count ++ " " ++ noun ++ " in voice in " ++ channel ++ statusText ++ "; join voice"


{-| Chip title: names joined, then " · status". -}
chipTitle : List String -> RoomStatus -> String
chipTitle names status =
    [ String.join ", " names, status.label ]
        |> List.filter (not << String.isEmpty)
        |> String.join " · "


type Banner
    = BannerInvite Int
    | BannerFailed


{-| Pre-join banner (§2.3). At most one shows: the failed banner for
the room whose last join failed, else the invite while you are idle
and someone is in voice (unless hidden for this room this session).
-}
bannerFor :
    { a
        | calls : CallHub
        , media : MediaState
        , callBannerDismissed : Set String
        , callJoinTarget : Maybe String
    }
    -> String
    -> Maybe Banner
bannerFor model room =
    let
        count =
            List.length (rosterFor model.media room)
    in
    if model.calls.lifecycle /= Idle then
        Nothing

    else if model.calls.outcome == Just CallFailed && sameTarget model.callJoinTarget room then
        Just BannerFailed

    else if count > 0 && not (Set.member (String.toLower room) model.callBannerDismissed) then
        Just (BannerInvite count)

    else
        Nothing


{-| "{n} person is|people are in voice." (new copy). -}
inviteTitle : Int -> String
inviteTitle count =
    if count == 1 then
        "1 person is in voice."

    else
        String.fromInt count ++ " people are in voice."



-- C2 · STAGE


{-| Stage status line (§2.5), plus " · {security label}" when known
(never appended while idle).
-}
stageStatus : CallHub -> Maybe String -> String
stageStatus hub securityLabel =
    let
        presentation =
            Media.classifyHubPresentation hub.lifecycle hub.startedAt

        base =
            case presentation of
                HubEstablished ->
                    "Call is live"

                HubIdle ->
                    if hub.outcome == Just CallEnded then
                        "Call ended"

                    else
                        "Ready to join…"

                _ ->
                    "Connecting to the call…"
    in
    case ( securityLabel, presentation ) of
        ( _, HubIdle ) ->
            base

        ( Just label, _ ) ->
            base ++ " · " ++ label

        ( Nothing, _ ) ->
            base


type alias Person =
    { key : String
    , name : String
    , self : Bool
    , speaking : Bool
    , muted : Bool
    , hand : Bool
    , role : Maybe String
    }


{-| Person cells (§2.5): self always first, then peers in join order
(never re-sorted on speaking). Speaking only counts while unmuted.
-}
stagePeople :
    { ourNick : String
    , roster : List String
    , media : MediaState
    , selfMuted : Bool
    , displayName : String -> String
    , roleOf : String -> Maybe String
    }
    -> List Person
stagePeople input =
    let
        selfKey =
            String.toLower input.ourNick

        peers =
            input.roster
                |> List.map String.toLower
                |> List.filter (\k -> k /= selfKey && not (String.isEmpty k))
                |> dedupe

        person isSelf key =
            let
                muted =
                    Set.member key input.media.muted || (isSelf && input.selfMuted)
            in
            { key = key
            , name =
                if isSelf then
                    input.ourNick

                else
                    input.displayName key
            , self = isSelf
            , speaking = Set.member key input.media.speaking && not muted
            , muted = muted
            , hand = Set.member key input.media.hands
            , role = input.roleOf key
            }
    in
    (if String.isEmpty selfKey then
        []

     else
        [ person True selfKey ]
    )
        ++ List.map (person False) peers


dedupe : List String -> List String
dedupe items =
    List.foldl
        (\item ( seen, acc ) ->
            if Set.member item seen then
                ( seen, acc )

            else
                ( Set.insert item seen, item :: acc )
        )
        ( Set.empty, [] )
        items
        |> Tuple.second
        |> List.reverse


{-| Person aria: name, " (you)", then speaking / muted / hand raised. -}
personAria : Person -> String
personAria p =
    String.join ", "
        ((p.name
            ++ (if p.self then
                    " (you)"

                else
                    ""
               )
         )
            :: List.filterMap identity
                [ boolWord p.speaking "speaking"
                , boolWord p.muted "muted"
                , boolWord p.hand "hand raised"
                ]
        )


boolWord : Bool -> String -> Maybe String
boolWord on word =
    if on then
        Just word

    else
        Nothing


{-| Role sub-line from channel modes — a word, never a sigil. -}
roleWord : Set Char -> Maybe String
roleWord modes =
    if Set.member 'Q' modes || Set.member 'q' modes then
        Just "owner"

    else if Set.member 'a' modes || Set.member 'o' modes then
        Just "op"

    else if Set.member 'v' modes then
        Just "voice"

    else
        Nothing


type StageDensity
    = DensityFull
    | DensityCompact
    | DensityCollapsed


{-| Up to 12 full cells; 13–24 compact; 25+ collapse to a facepile. -}
stageDensity : Int -> StageDensity
stageDensity count =
    if count <= 12 then
        DensityFull

    else if count <= 24 then
        DensityCompact

    else
        DensityCollapsed


{-| "N person|people". -}
peopleLabel : Int -> String
peopleLabel count =
    if count == 1 then
        "1 person"

    else
        String.fromInt count ++ " people"


{-| Call timer: `MM:SS` / `H:MM:SS` plus its spoken form. -}
formatDuration : Int -> { text : String, aria : String }
formatDuration ms =
    let
        total =
            max 0 ms // 1000

        h =
            total // 3600

        m =
            modBy 60 (total // 60)

        s =
            modBy 60 total

        pad n =
            String.padLeft 2 '0' (String.fromInt n)

        unit n word padded =
            (if padded then
                pad n

             else
                String.fromInt n
            )
                ++ " "
                ++ word
                ++ (if n == 1 then
                        ""

                    else
                        "s"
                   )
    in
    if h > 0 then
        { text = String.fromInt h ++ ":" ++ pad m ++ ":" ++ pad s
        , aria = "Call duration: " ++ unit h "hour" False ++ " " ++ unit m "minute" True ++ " " ++ unit s "second" True
        }

    else
        { text = pad m ++ ":" ++ pad s
        , aria = "Call duration: " ++ unit m "minute" False ++ " " ++ unit s "second" True
        }



-- C2 · ANNOUNCER


{-| Roster-delta announcer state (`CallStatusAnnouncer`): a silent
baseline on the first in-call settle, then joins/leaves only.
-}
type alias Announcer =
    { baseline : Maybe (List String)
    , hands : List String
    , message : String
    }


blankAnnouncer : Announcer
blankAnnouncer =
    { baseline = Nothing
    , hands = []
    , message = ""
    }


{-| "alice", "alice and bob", "alice, bob and carol", "5 people". -}
nameList : List String -> String
nameList names =
    if List.length names > 3 then
        String.fromInt (List.length names) ++ " people"

    else
        case List.reverse names of
            [] ->
                ""

            [ one ] ->
                one

            last :: restReversed ->
                String.join ", " (List.reverse restReversed) ++ " and " ++ last


verbFor : List String -> String
verbFor names =
    if List.length names == 1 then
        "has"

    else
        "have"


{-| One announcer step over the current call state. Only `InCall`
announces; anything else resets the baseline (a later call
re-baselines quietly). Self never announces. A peer newly raising a
hand adds "{nick} raised a hand" (new copy, §3.3).
-}
announceStep : (String -> String) -> String -> CallHub -> MediaState -> Announcer -> Announcer
announceStep displayName ourNick hub media prev =
    if hub.lifecycle /= InCall then
        if prev.baseline == Nothing && List.isEmpty prev.hands then
            prev

        else
            { blankAnnouncer | message = prev.message }

    else
        let
            selfKey =
                String.toLower ourNick

            current =
                callRoster media hub
                    |> List.map String.toLower
                    |> List.filter (\k -> k /= selfKey)
                    |> dedupe

            hands =
                List.filter (\k -> Set.member k media.hands) current
        in
        case prev.baseline of
            Nothing ->
                { prev | baseline = Just current, hands = hands }

            Just before ->
                let
                    joined =
                        List.filter (\k -> not (List.member k before)) current

                    left =
                        List.filter (\k -> not (List.member k current)) before

                    raised =
                        List.filter (\k -> not (List.member k prev.hands)) hands

                    names =
                        List.map displayName

                    parts =
                        (if List.isEmpty joined then
                            []

                         else
                            [ nameList (names joined) ++ " " ++ verbFor joined ++ " joined the call" ]
                        )
                            ++ (if List.isEmpty left then
                                    []

                                else
                                    [ nameList (names left) ++ " " ++ verbFor left ++ " left the call" ]
                               )
                            ++ List.map (\k -> displayName k ++ " raised a hand") raised
                in
                if List.isEmpty parts then
                    if before == current && prev.hands == hands then
                        prev

                    else
                        { prev | baseline = Just current, hands = hands }

                else
                    { baseline = Just current
                    , hands = hands
                    , message = String.join ". " parts
                    }


{-| Post-update settle for the call surfaces: advance the announcer
and drop the More popover / privacy sheet once the call is idle.
-}
settle :
    (String -> String)
    ->
        { a
            | calls : CallHub
            , media : MediaState
            , ourNick : String
            , callAnnouncer : Announcer
            , callMoreOpen : Bool
            , callPrivacyOpen : Bool
        }
    ->
        { a
            | calls : CallHub
            , media : MediaState
            , ourNick : String
            , callAnnouncer : Announcer
            , callMoreOpen : Bool
            , callPrivacyOpen : Bool
        }
settle displayName model =
    let
        announcer =
            announceStep displayName model.ourNick model.calls model.media model.callAnnouncer

        idle =
            model.calls.lifecycle == Idle
    in
    if announcer == model.callAnnouncer && not (idle && (model.callMoreOpen || model.callPrivacyOpen)) then
        model

    else
        { model
            | callAnnouncer = announcer
            , callMoreOpen = model.callMoreOpen && not idle
            , callPrivacyOpen = model.callPrivacyOpen && not idle
        }



-- C3 · SECURITY


type SecurityLevel
    = SecConnecting
    | SecHopProtected
    | SecE2ee
    | SecE2eeDegraded
    | SecInsecure
    | SecStage


type SecurityIcon
    = IconSpinner
    | IconShield
    | IconLock
    | IconLockOpen
    | IconWarning
    | IconStage


type SecurityTone
    = ToneOk
    | ToneWarn
    | ToneDanger


type FingerprintState
    = FpUnavailable
    | FpLoading
    | FpReady String


type alias SfuInput =
    { localSfu : Bool
    , remoteForwarders : Int
    , packetLoss : Float
    }


{-| Engine-reported trust inputs, carried on the `voiceCallHub`
snapshot. Every flag defaults to "not shipped / unknown"; nothing
here can claim more than the engine reported.
-}
type alias SecurityFeed =
    { e2eeActive : Bool
    , e2eeDegraded : Bool
    , stageMode : Bool
    , transportInsecure : Bool
    , localFingerprint : FingerprintState
    , peerFingerprints : Dict String String
    , sfu : Maybe SfuInput
    }


blankSecurityFeed : SecurityFeed
blankSecurityFeed =
    { e2eeActive = False
    , e2eeDegraded = False
    , stageMode = False
    , transportInsecure = False
    , localFingerprint = FpUnavailable
    , peerFingerprints = Dict.empty
    , sfu = Nothing
    }


type alias Security =
    { level : SecurityLevel
    , icon : SecurityIcon
    , label : String
    , detail : String
    , usesPadlock : Bool
    , tone : SecurityTone
    }


{-| Port of `resolveCallSecurity`. Nothing while idle. Priority:
stage > insecure > degraded > e2ee > connecting (ringing) > hop.
The closed padlock is gated by the C7 honesty table: only an
in-call, non-stage, non-insecure, non-degraded, E2EE-active call
may show it; any other "lock" base degrades to an open lock.
-}
resolveSecurity : CallLifecycle -> SecurityFeed -> Maybe Security
resolveSecurity lifecycle feed =
    let
        ringing =
            lifecycle == RingingIn || lifecycle == RingingOut

        honestPrivate =
            not feed.transportInsecure
                && not ringing
                && not feed.stageMode
                && not feed.e2eeDegraded
                && feed.e2eeActive

        build level icon label detail tone =
            Just
                { level = level
                , icon =
                    if honestPrivate then
                        IconLock

                    else if icon == IconLock then
                        IconLockOpen

                    else
                        icon
                , label = label
                , detail = detail
                , usesPadlock = honestPrivate
                , tone = tone
                }
    in
    if lifecycle == Idle then
        Nothing

    else if feed.stageMode then
        build SecStage IconStage "Stage broadcast" "Stage — broadcast mode. Not a private call." ToneWarn

    else if feed.transportInsecure then
        build SecInsecure IconWarning "Not secure" "Call not secure — leave if you expected a protected connection." ToneDanger

    else if feed.e2eeDegraded then
        build SecE2eeDegraded IconLockOpen "Not end-to-end" "Not end-to-end encrypted while outdated clients are present." ToneWarn

    else if feed.e2eeActive then
        build SecE2ee IconLock "End-to-end encrypted" "End-to-end encrypted — only people in this call can hear or see." ToneOk

    else if ringing then
        build SecConnecting IconSpinner "Connecting…" "Establishing a protected connection to this server." ToneWarn

    else
        build SecHopProtected IconShield "Protected connection" "Protected connection — encrypted to this server. Server operators can access call media." ToneOk


levelWord : SecurityLevel -> String
levelWord level =
    case level of
        SecConnecting ->
            "connecting"

        SecHopProtected ->
            "hop_protected"

        SecE2ee ->
            "e2ee"

        SecE2eeDegraded ->
            "e2ee_degraded"

        SecInsecure ->
            "insecure"

        SecStage ->
            "stage"


iconWord : SecurityIcon -> String
iconWord icon =
    case icon of
        IconSpinner ->
            "spinner"

        IconShield ->
            "shield"

        IconLock ->
            "lock"

        IconLockOpen ->
            "lock-open"

        IconWarning ->
            "warning"

        IconStage ->
            "stage"


toneWord : SecurityTone -> String
toneWord tone =
    case tone of
        ToneOk ->
            "ok"

        ToneWarn ->
            "warn"

        ToneDanger ->
            "danger"


{-| Sheet title by level (`resolveCallPrivacy`). -}
privacyTitle : SecurityLevel -> String
privacyTitle level =
    case level of
        SecE2ee ->
            "End-to-end encrypted call"

        SecInsecure ->
            "Call not secure"

        SecStage ->
            "Stage broadcast"

        _ ->
            "Call privacy"


{-| "Media path" row: operators can access media unless E2EE. -}
mediaPathCopy : SecurityLevel -> String
mediaPathCopy level =
    if level == SecE2ee then
        "End-to-end — only people in this call can hear or see."

    else
        "Encrypted to this server — operators can access call media."


type alias SfuView =
    { mode : String
    , hops : Int
    , label : String
    , detail : String
    }


{-| Port of `sfuCascadeView`. -}
sfuView : Maybe SfuInput -> SfuView
sfuView input =
    case input of
        Nothing ->
            { mode = "unknown", hops = 0, label = "SFU path unknown", detail = "Waiting for media plane topology." }

        Just sfu ->
            let
                forwarders =
                    max 0 sfu.remoteForwarders
            in
            if sfu.packetLoss >= 0.15 then
                { mode = "degraded"
                , hops = forwarders + 1
                , label = "Media path degraded"
                , detail =
                    "High loss ("
                        ++ String.fromInt (round (sfu.packetLoss * 100))
                        ++ "%) across "
                        ++ String.fromInt (forwarders + 1)
                        ++ " hop(s)."
                }

            else if forwarders > 0 then
                { mode = "cascade"
                , hops = forwarders + 1
                , label = "Network relay · " ++ String.fromInt (forwarders + 1) ++ " hops"
                , detail = "Relayed through " ++ String.fromInt forwarders ++ " remote SFU forwarder(s)."
                }

            else if sfu.localSfu then
                { mode = "local", hops = 1, label = "Local SFU", detail = "All media stays on this network node." }

            else
                { mode = "unknown", hops = 0, label = "SFU path unknown", detail = "No SFU topology advertised yet." }


base58Alphabet : String
base58Alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


{-| A media fingerprint is exactly 12 Base58 characters
(`MooringSession.ts`); anything else is not shown.
-}
validFingerprint : String -> Bool
validFingerprint code =
    String.length code == 12 && String.all (\c -> String.contains (String.fromChar c) base58Alphabet) code


{-| "3Qm7Kx9P2bVe" → "3Qm7 Kx9P 2bVe". -}
fingerprintGroups : String -> String
fingerprintGroups code =
    String.join " " [ String.slice 0 4 code, String.slice 4 8 code, String.slice 8 12 code ]


{-| Fold the optional trust fields of one `voiceCallHub` snapshot
over the previous feed. An idle snapshot clears everything; an
absent field keeps the previous value (lifecycle-only snapshots must
not blank the sheet); a present-but-invalid field fails closed (flag
false, fingerprint unavailable, peer dropped). A `securityLevel`
word, when present, replaces the four flags wholesale (it can only
raise the one flag it names).
-}
decodeSecurityFeed : CallLifecycle -> Decode.Value -> SecurityFeed -> SecurityFeed
decodeSecurityFeed lifecycle raw prev =
    if lifecycle == Idle then
        blankSecurityFeed

    else
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

            level =
                field "securityLevel" Decode.string |> Maybe.andThen identity

            fromLevel word name previous =
                case level of
                    Just said ->
                        flag name False || said == word

                    Nothing ->
                        flag name previous

            pending =
                field "fingerprintPending" Decode.bool == Just (Just True)

            fingerprint =
                case field "localFingerprint" (Decode.nullable Decode.string) of
                    Just (Just (Just code)) ->
                        if validFingerprint code then
                            FpReady code

                        else
                            FpUnavailable

                    Just _ ->
                        if pending then
                            FpLoading

                        else
                            FpUnavailable

                    Nothing ->
                        if pending then
                            FpLoading

                        else
                            prev.localFingerprint

            peers =
                case field "peerFingerprints" (Decode.keyValuePairs Decode.value) of
                    Just (Just pairs) ->
                        pairs
                            |> List.filterMap
                                (\( nick, value ) ->
                                    case Decode.decodeValue Decode.string value of
                                        Ok code ->
                                            if Media.validEngineNick nick && validFingerprint code then
                                                Just ( String.toLower nick, code )

                                            else
                                                Nothing

                                        Err _ ->
                                            Nothing
                                )
                            |> List.take Media.maxParticipants
                            |> Dict.fromList

                    Just Nothing ->
                        Dict.empty

                    Nothing ->
                        prev.peerFingerprints

            sfuDecoder =
                Decode.map3 SfuInput
                    (Decode.oneOf [ Decode.field "localSfu" Decode.bool, Decode.succeed False ])
                    (Decode.oneOf [ Decode.field "remoteForwarders" Decode.int, Decode.succeed 0 ])
                    (Decode.oneOf [ Decode.field "packetLoss" Decode.float, Decode.succeed 0 ])

            sfu =
                case field "sfu" (Decode.nullable sfuDecoder) of
                    Just (Just value) ->
                        value

                    Just Nothing ->
                        Nothing

                    Nothing ->
                        prev.sfu
        in
        { e2eeActive = fromLevel "e2ee" "e2eeActive" prev.e2eeActive
        , e2eeDegraded = fromLevel "e2ee_degraded" "e2eeDegraded" prev.e2eeDegraded
        , stageMode = fromLevel "stage" "stageMode" prev.stageMode
        , transportInsecure = fromLevel "insecure" "transportInsecure" prev.transportInsecure
        , localFingerprint = fingerprint
        , peerFingerprints = peers
        , sfu = sfu
        }
