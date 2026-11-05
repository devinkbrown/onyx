module MediaReadiness exposing (DeviceState(..), Effect(..), Model, Msg(..), Phase(..), init, retire, update)

{-| Public media readiness only. MediaStream, device IDs, identity keys and
packet contents remain in the browser runtime.
-}

import Set exposing (Set)


type Phase
    = Unsupported
    | NeedsPermission
    | Checking
    | Ready
    | InCall String String
    | Degraded String
    | Failed String


type DeviceState
    = DeviceUnknown
    | DeviceAvailable
    | DeviceMissing
    | DeviceDenied


type alias Model =
    { phase : Phase
    , input : DeviceState
    , output : DeviceState
    , muted : Bool
    , deafened : Bool
    , ownerRef : String
    , retired : Set String
    , requestId : Maybe String
    }


type Msg
    = PermissionRequested String
    | SoundcheckRequested String
    | JoinRequested String String String
    | LeaveRequested String
    | MuteChanged Bool
    | DeafenChanged Bool
    | RuntimeStatusReceived Phase
    | DeviceStateReceived DeviceState DeviceState
    | OwnerRetired String


type Effect
    = RequestPermission String
    | RequestSoundcheck String
    | RequestJoin String String String
    | RequestLeave String
    | SetMuted Bool
    | SetDeafened Bool
    | NoEffect


init : String -> Model
init ownerRef =
    { phase = NeedsPermission
    , input = DeviceUnknown
    , output = DeviceUnknown
    , muted = False
    , deafened = False
    , ownerRef = ownerRef
    , retired = Set.empty
    , requestId = Nothing
    }


update : Msg -> Model -> ( Model, Effect )
update msg model =
    case msg of
        PermissionRequested requestId ->
            ( { model | phase = Checking, requestId = Just requestId }, RequestPermission requestId )

        SoundcheckRequested requestId ->
            ( { model | phase = Checking, requestId = Just requestId }, RequestSoundcheck requestId )

        JoinRequested requestId conversation kind ->
            if String.isEmpty requestId || String.isEmpty conversation || (kind /= "voice" && kind /= "video") then
                ( { model | phase = Failed "invalid-call-intent" }, NoEffect )

            else
                ( { model | phase = Checking, requestId = Just requestId }, RequestJoin requestId conversation kind )

        LeaveRequested requestId ->
            ( { model | requestId = Just requestId }, RequestLeave requestId )

        MuteChanged muted ->
            ( { model | muted = muted }, SetMuted muted )

        DeafenChanged deafened ->
            ( { model | deafened = deafened }, SetDeafened deafened )

        RuntimeStatusReceived phase ->
            ( { model | phase = phase }, NoEffect )

        DeviceStateReceived input output ->
            ( { model | input = input, output = output }, NoEffect )

        OwnerRetired ownerRef ->
            ( { model | retired = Set.insert ownerRef model.retired, phase = NeedsPermission, requestId = Nothing }, NoEffect )


retire : String -> Model -> Model
retire ownerRef model =
    { model | retired = Set.insert ownerRef model.retired, phase = NeedsPermission, requestId = Nothing }
