from utils.avatar_utils import avatar_object_name_for_user, random_avatar_object_name


def test_avatar_object_name_for_user_is_deterministic():
    first = avatar_object_name_for_user("user-123")
    second = avatar_object_name_for_user("user-123")
    assert first == second


def test_avatar_object_name_for_user_stays_in_fixed_range():
    name = avatar_object_name_for_user("user-456")
    assert name.startswith("avatars/face-")
    assert name.endswith(".jpg")
    face_number = int(name.removeprefix("avatars/face-").removesuffix(".jpg"))
    assert 1 <= face_number <= 15


def test_random_avatar_object_name_stays_in_fixed_range():
    name = random_avatar_object_name()
    assert name.startswith("avatars/face-")
    assert name.endswith(".jpg")
    face_number = int(name.removeprefix("avatars/face-").removesuffix(".jpg"))
    assert 1 <= face_number <= 15
