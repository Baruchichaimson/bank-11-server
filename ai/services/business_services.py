from ai.services.account_service import create_account_service
from ai.services.profile_service import create_profile_service
from ai.services.risk_service import create_risk_service
from ai.services.support_service import create_support_service
from ai.services.transaction_service import create_transaction_service


def create_business_services():
    account_service = create_account_service()
    profile_service = create_profile_service()

    return {
        "accountService": account_service,
        "transactionService": create_transaction_service(
            account_service=account_service,
            profile_service=profile_service,
        ),
        "supportService": create_support_service(),
        "profileService": profile_service,
        "riskService": create_risk_service(),
    }
